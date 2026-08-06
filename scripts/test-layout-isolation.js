// Automated tests: one hospital can never see or edit another's floor plans.
//
// Covers every layout endpoint:
//   - a plain member is refused all layout writes
//   - an IT user is refused reads/writes on a hospital that isn't theirs
//   - an admin succeeds anywhere (including hospitals that aren't their active one)
//   - GET /api/heatmap and GET /api/locations/:id/reports leak nothing across
//     hospitals
//   - deleting a location with tickets returns 409 with can_deactivate: true
//
// Runs against the live dev server (http://127.0.0.1:5000) and sets up / tears
// down its own fixtures directly in the database. Exit code 0 = all passed.

const crypto = require("crypto");
const { Pool } = require("pg");

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASSWORD = "layout-test-pass-1";
const MEMBER_EMAIL = "layout-test-member@example.test";
const IT_EMAIL = "layout-test-it@example.test";
const MARK = "[layout-isolation-test]"; // tags fixture rows for cleanup

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
}

// --- Tiny cookie-jar HTTP client -----------------------------------------
function makeSession() {
  let cookie = null;
  return async function (method, path, body) {
    const res = await fetch(BASE + path, {
      method: method,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        cookie ? { Cookie: cookie } : {}
      ),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* non-JSON body */
    }
    return { status: res.status, body: json };
  };
}

// --- Assertions ------------------------------------------------------------
let failures = 0;
let passes = 0;
function check(label, ok, detail) {
  if (ok) {
    passes++;
    console.log("  ok - " + label);
  } else {
    failures++;
    console.error("  FAIL - " + label + (detail ? " :: " + JSON.stringify(detail) : ""));
  }
}

async function main() {
  // ---- Fixtures -----------------------------------------------------------
  const hosps = await pool.query("SELECT id, name FROM hospitals ORDER BY id");
  const other = hosps.rows.find((h) => h.name === "Testing Ground");
  const home = hosps.rows.find((h) => h.name !== "Testing Ground");
  if (!other || !home) throw new Error("Need Testing Ground plus one more hospital.");
  // hospA: the member/IT users' hospital. hospB: the one they must never touch.
  const hospA = home.id;
  const hospB = other.id;

  await pool.query("DELETE FROM users WHERE email = ANY($1)", [[MEMBER_EMAIL, IT_EMAIL]]);
  await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, profession, hospital_id, access_level)
     VALUES ($1, $2, 'Test', 'Member', 'Staff Nurse', $3, 'member'),
            ($4, $5, 'Test', 'ITUser', 'IT Support', $3, 'it')`,
    [MEMBER_EMAIL, hashPassword(PASSWORD), hospA, IT_EMAIL, hashPassword(PASSWORD)]
  );

  // A floor + active room in each hospital (from the seeded layouts).
  async function pickFloorAndRoom(hospId) {
    const floor = (
      await pool.query(
        "SELECT id, name FROM locations WHERE hospital_id = $1 AND kind = 'floor' ORDER BY id LIMIT 1",
        [hospId]
      )
    ).rows[0];
    const room = (
      await pool.query(
        `WITH RECURSIVE down AS (
           SELECT id FROM locations WHERE id = $1
           UNION ALL
           SELECT l.id FROM locations l JOIN down d ON l.parent_id = d.id
         )
         SELECT id, name FROM locations
         WHERE id IN (SELECT id FROM down) AND kind = 'room' AND active
         ORDER BY id LIMIT 1`,
        [floor.id]
      )
    ).rows[0];
    return { floor, room };
  }
  const inA = await pickFloorAndRoom(hospA);
  const inB = await pickFloorAndRoom(hospB);
  if (!inA.floor || !inA.room || !inB.floor || !inB.room) {
    throw new Error("Seeded layouts missing a floor/room; cannot run tests.");
  }

  // A ticket pinned to a room in hospital A, so deleting that room must 409.
  const admin = (await pool.query("SELECT id FROM users WHERE email = 'admin'")).rows[0];
  await pool.query("DELETE FROM reports WHERE description LIKE $1", [MARK + "%"]);
  const ticket = (
    await pool.query(
      `INSERT INTO reports (category, description, priority, status, user_id, hospital_id, location_id)
       VALUES ('Other', $1, 'Low', 'Open', $2, $3, $4) RETURNING id`,
      [MARK + " ticket for delete-409 test", admin ? admin.id : null, hospA, inA.room.id]
    )
  ).rows[0];

  // ---- Sessions -----------------------------------------------------------
  const member = makeSession();
  const it = makeSession();
  const adm = makeSession();
  const logins = await Promise.all([
    member("POST", "/api/login", { email: MEMBER_EMAIL, password: PASSWORD }),
    it("POST", "/api/login", { email: IT_EMAIL, password: PASSWORD }),
    adm("POST", "/api/login", { email: "admin", password: "ADMIN123" }),
  ]);
  logins.forEach((r, i) => {
    if (r.status !== 200) throw new Error("Login " + i + " failed: " + JSON.stringify(r));
  });
  // Admin's active hospital is Testing Ground (hospB), so every admin call
  // against hospA below exercises the is_admin cross-hospital branch.

  const createdLocationIds = [];
  const createdRoomTypeIds = [];
  try {
    // ---- GET /api/layout --------------------------------------------------
    console.log("GET /api/layout");
    let r = await member("GET", "/api/layout?hospital_id=" + hospB);
    check("member cannot read another hospital's layout", r.status === 403, r);
    r = await it("GET", "/api/layout?hospital_id=" + hospB);
    check("IT cannot read another hospital's layout", r.status === 403, r);
    r = await it("GET", "/api/layout");
    check(
      "IT reads own hospital's layout only",
      r.status === 200 && r.body.hospital_id === hospA,
      r
    );
    r = await adm("GET", "/api/layout?hospital_id=" + hospA);
    check(
      "admin reads any hospital's layout",
      r.status === 200 && r.body.hospital_id === hospA && r.body.can_edit === true,
      r
    );

    // ---- POST /api/room-types ----------------------------------------------
    console.log("POST /api/room-types");
    const rtName = MARK + " room type " + Date.now();
    r = await member("POST", "/api/room-types", { name: rtName });
    check("member refused room-type write", r.status === 403, r);
    r = await it("POST", "/api/room-types", { name: rtName, hospital_id: hospB });
    check("IT refused room-type write on another hospital", r.status === 403, r);
    r = await adm("POST", "/api/room-types", { name: rtName, hospital_id: hospA });
    check(
      "admin adds room type in any hospital",
      r.status === 201 && r.body.hospital_id === hospA,
      r
    );
    if (r.status === 201) createdRoomTypeIds.push(r.body.id);

    // ---- POST /api/locations -----------------------------------------------
    console.log("POST /api/locations");
    const locName = MARK + " building " + Date.now();
    r = await member("POST", "/api/locations", { kind: "building", name: locName });
    check("member refused location create", r.status === 403, r);
    r = await it("POST", "/api/locations", {
      kind: "building",
      name: locName,
      hospital_id: hospB,
    });
    check("IT refused location create in another hospital", r.status === 403, r);
    r = await adm("POST", "/api/locations", {
      kind: "building",
      name: locName,
      hospital_id: hospA,
    });
    check(
      "admin creates location in any hospital",
      r.status === 201 && r.body.hospital_id === hospA,
      r
    );
    const adminBuildingId = r.status === 201 ? r.body.id : null;
    if (adminBuildingId) createdLocationIds.push(adminBuildingId);

    // ---- PATCH /api/locations/:id -------------------------------------------
    console.log("PATCH /api/locations/:id");
    r = await member("PATCH", "/api/locations/" + inA.room.id, { name: "hacked" });
    check("member refused location edit", r.status === 403, r);
    r = await it("PATCH", "/api/locations/" + inB.room.id, { name: "hacked" });
    check("IT refused edit of another hospital's location", r.status === 403, r);
    const renamed = (
      await pool.query("SELECT name FROM locations WHERE id = $1", [inB.room.id])
    ).rows[0].name;
    check("cross-hospital edit did not stick", renamed !== "hacked", renamed);
    r = await adm("PATCH", "/api/locations/" + inA.room.id, { name: inA.room.name });
    check("admin edits location in any hospital", r.status === 200, r);

    // ---- DELETE /api/locations/:id -------------------------------------------
    console.log("DELETE /api/locations/:id");
    r = await member("DELETE", "/api/locations/" + inA.room.id);
    check("member refused location delete", r.status === 403, r);
    r = await it("DELETE", "/api/locations/" + inB.room.id);
    check("IT refused delete of another hospital's location", r.status === 403, r);
    r = await adm("DELETE", "/api/locations/" + inA.room.id);
    check(
      "deleting a room with tickets returns 409 + can_deactivate",
      r.status === 409 && r.body.can_deactivate === true && r.body.report_count >= 1,
      r
    );
    const stillThere = (
      await pool.query("SELECT id FROM locations WHERE id = $1", [inA.room.id])
    ).rowCount;
    check("room with tickets was not deleted", stillThere === 1);
    if (adminBuildingId) {
      r = await adm("DELETE", "/api/locations/" + adminBuildingId);
      check("admin deletes empty location in any hospital", r.status === 200, r);
      if (r.status === 200) createdLocationIds.pop();
    }

    // ---- GET /api/heatmap ------------------------------------------------------
    console.log("GET /api/heatmap");
    r = await it("GET", "/api/heatmap?hospital_id=" + hospB + "&floor_id=" + inB.floor.id);
    check("IT refused heatmap of another hospital", r.status === 403, r);
    r = await member("GET", "/api/heatmap?floor_id=" + inB.floor.id);
    check(
      "another hospital's floor yields no heatmap data (member)",
      r.status === 404 && !(r.body && r.body.blocks && r.body.blocks.length),
      r
    );
    r = await it("GET", "/api/heatmap?floor_id=" + inB.floor.id);
    check(
      "another hospital's floor yields no heatmap data (IT)",
      r.status === 404 && !(r.body && r.body.blocks && r.body.blocks.length),
      r
    );
    r = await adm("GET", "/api/heatmap?hospital_id=" + hospA + "&floor_id=" + inA.floor.id);
    check("admin reads heatmap of any hospital", r.status === 200 && Array.isArray(r.body.blocks), r);

    // ---- GET /api/locations/:id/reports ------------------------------------------
    console.log("GET /api/locations/:id/reports");
    r = await member("GET", "/api/locations/" + inB.room.id + "/reports");
    check(
      "another hospital's room yields no reports (member)",
      r.status === 404 && !Array.isArray(r.body),
      r
    );
    r = await it("GET", "/api/locations/" + inB.room.id + "/reports");
    check(
      "another hospital's room yields no reports (IT)",
      r.status === 404 && !Array.isArray(r.body),
      r
    );
    r = await it("GET", "/api/locations/" + inA.room.id + "/reports");
    check("own hospital's room reports still readable", r.status === 200 && Array.isArray(r.body), r);
  } finally {
    // ---- Teardown ----------------------------------------------------------
    await pool.query("DELETE FROM reports WHERE id = $1", [ticket.id]);
    for (const id of createdLocationIds) {
      await pool.query("DELETE FROM locations WHERE id = $1", [id]);
    }
    for (const id of createdRoomTypeIds) {
      await pool.query("DELETE FROM room_types WHERE id = $1", [id]);
    }
    await pool.query("DELETE FROM users WHERE email = ANY($1)", [[MEMBER_EMAIL, IT_EMAIL]]);
    await pool.end();
  }

  console.log("\n" + passes + " passed, " + failures + " failed");
  if (failures > 0) process.exit(1);
}

main().catch(function (err) {
  console.error("Test run crashed:", err);
  process.exit(1);
});
