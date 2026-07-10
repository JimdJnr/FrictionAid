const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { Pool } = require("pg");
const PgSession = require("connect-pg-simple")(session);
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET is not set — cannot run without it.");
  process.exit(1);
}

app.use(express.json({ limit: "2mb" }));

// Behind Replit's TLS-terminating proxy: trust it so secure cookies work.
app.set("trust proxy", 1);
app.use(
  session({
    store: new PgSession({ pool: pool, createTableIfMissing: true }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Only require HTTPS for the cookie in production; dev is served over
      // http inside the workspace.
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// --- Password hashing (scrypt; salt stored alongside the hash) ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + derived;
}
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(":") === -1) return false;
  const parts = stored.split(":");
  const salt = parts[0];
  const key = Buffer.from(parts[1], "hex");
  const derived = crypto.scryptSync(password, salt, 64);
  return key.length === derived.length && crypto.timingSafeEqual(key, derived);
}

function fullName(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.email;
}

// Columns returned for an account (joined to the user's home hospital name).
const USER_SELECT =
  "SELECT u.id, u.email, u.first_name, u.last_name, u.profession, u.alias, u.avatar, u.hospital_id, u.theme_color, u.font_scale, u.dark_mode, u.voice_autostart, u.is_admin, u.access_level, h.name AS hospital_name FROM users u LEFT JOIN hospitals h ON h.id = u.hospital_id";

async function fetchUserById(id) {
  const r = await pool.query(USER_SELECT + " WHERE u.id = $1", [id]);
  return r.rows[0] || null;
}

// Attach the current session's active hospital (defaults to the home hospital)
// so the client always knows which department the user is "in".
function withActive(user, req) {
  if (!user) return user;
  user.active_hospital_id =
    (req.session && req.session.activeHospitalId) || user.hospital_id || null;
  return user;
}

// The hospital the signed-in user is currently working in (their active
// department, else their home hospital). Null means "not part of a hospital",
// in which case reports and staff rosters are hidden.
function activeHospitalId(req) {
  return (
    (req.session && req.session.activeHospitalId) ||
    (req.user && req.user.hospital_id) ||
    null
  );
}

// --- Management hierarchy (access levels) ---
// member < it < it_lead < admin (is_admin). Authorization lives in this column,
// NOT in the free-text `profession`, so it can never be self-assigned at
// registration. Higher ranks can manage everyone strictly below them and can
// only grant a role below their own rank (keeps the hierarchy from being
// escalated sideways or upward).
const ACCESS_LEVELS = ["member", "it", "it_lead"];
const ACCESS_LABELS = { member: "Member", it: "IT", it_lead: "IT Lead" };
function accessRank(user) {
  if (!user) return 0;
  if (user.is_admin) return 3;
  const i = ACCESS_LEVELS.indexOf(user.access_level);
  return i < 0 ? 0 : i;
}

// --- Presence: who is actually signed in right now (real, not fake) ---
// Presence is derived directly from the live SSE connections (see `sseClients`
// and the helpers below), so a user is "online in a department" while they have
// an event stream tagged to it. This keys presence off the *active* department
// (re-tagged on switch) rather than the user's home hospital, so colleagues who
// switch into your section show up and are scoped to who's actually there.

// Require a signed-in user and attach their profile as req.user.
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Please sign in." });
  }
  try {
    const user = await fetchUserById(req.session.userId);
    if (!user) {
      req.session.destroy(function () {});
      return res.status(401).json({ error: "Please sign in." });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Keep this allowlist in sync with CATEGORIES in public/app.js.
const CATEGORIES = [
  "Searching for equipment",
  "Broken / faulty equipment",
  "Missing linen / laundry",
  "No beds / clinical space",
  "IT & computer problems",
  "Can't reach the right staff",
  "Waiting for porters / transport",
  "Supplies / stock shortages",
  "Medication / pharmacy delays",
  "Cleaning / environment",
  "Phone / communication issues",
  "Admin / paperwork / handovers",
  "Other",
];

const PRIORITIES = ["Low", "Medium", "High", "Emergency"];
const STATUSES = ["Open", "In progress", "Resolved"];
// Per-person availability for the schedule / auto-allocation system.
const AVAILABILITY_STATUSES = ["free", "busy"];

// Optional emotional impact the reporter can attach to a report.
// Keep this allowlist in sync with FEELINGS in public/app.js.
const FEELINGS = [
  "Frustrated",
  "Embarrassed",
  "Resentful",
  "Undervalued",
  "Helpless",
  "Cynical",
  "Grateful",
  "Relieved",
  "Supported",
  "Reassured",
  "Proud",
];

// Which profession(s) each report category is best handled by. Auto-allocation
// prefers a free colleague whose profession matches (falling back to any free
// colleague if none match). Keep in sync with CATEGORY_PROFESSIONS in
// public/app.js.
const CATEGORY_PROFESSIONS = {
  "Searching for equipment": ["Healthcare Assistant (HCA)", "Staff Nurse"],
  "Broken / faulty equipment": ["Medical Engineer (EBME)"],
  "Missing linen / laundry": ["Domestic / Housekeeping"],
  "No beds / clinical space": ["Ward Manager", "Ward Sister / Charge Nurse"],
  "IT & computer problems": ["IT Support"],
  "Can't reach the right staff": ["Ward Sister / Charge Nurse", "Ward Manager"],
  "Waiting for porters / transport": ["Porter"],
  "Supplies / stock shortages": ["Stores / Procurement", "Ward Clerk / Administrator"],
  "Medication / pharmacy delays": ["Pharmacist"],
  "Cleaning / environment": ["Domestic / Housekeeping", "Estates / Maintenance"],
  "Phone / communication issues": ["Telecoms", "Ward Clerk / Administrator"],
  "Admin / paperwork / handovers": ["Ward Clerk / Administrator"],
  Other: [],
};

// Optional department a reporter can designate a problem to. Never required —
// it's only set when the reporter names a department while describing the issue
// (smart-capture on the client, or the AI assist). Keep this allowlist in sync
// with DEPARTMENTS in public/app.js.
const DEPARTMENTS = [
  "IT",
  "Estates / Maintenance",
  "Housekeeping",
  "Portering",
  "Pharmacy",
  "Stores / Procurement",
  "Medical Engineering (EBME)",
  "Catering",
  "Telecoms / Switchboard",
  "Security",
  "Bed Management / Site Team",
  "Pathology / Labs",
  "Radiology / Imaging",
];

// Personalisation options (kept in sync with public/app.js).
const THEME_COLORS = ["#0f6cbd", "#107c41", "#8764b8", "#c4314b", "#d83b01", "#038387"];
const FONT_SCALES = ["small", "medium", "large"];
const MAX_ALIAS = 80;
const MAX_AVATAR = 1500000; // ~1 MB data URL

// Hospitals seeded on first boot. Passwords are intentionally simple and
// shown in the UI for now (this is a demo of the department-switch flow).
const HOSPITAL_SEED = [
  { name: "St. Mary's General", password: "stmary25" },
  { name: "Royal London Hospital", password: "royal-london" },
  { name: "Manchester Central", password: "manc-central" },
  { name: "Testing Ground", password: "testing" },
];

// A sandbox department + shared admin account so admins can trial the whole
// reporting flow (wizard, allocation, insights…) without touching real wards.
const TESTING_GROUND_NAME = "Testing Ground";
const ADMIN_SEED = {
  email: "admin",
  password: "ADMIN123",
  first_name: "Admin",
  last_name: "Tester",
  profession: "Administrator",
};

const MAX_DESCRIPTION = 2000;
const MAX_LOCATION = 200;
const MAX_RESPONSE = 1000;
const MAX_OUTCOME = 2000;
const MAX_UPDATE = 1000;

// Account fields.
const MAX_EMAIL = 200;
const MAX_NAME = 60;
const MAX_PROFESSION = 80;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How long a report stays visible in the active lists after being resolved
// before it moves to the "Resolved reports" section.
const RESOLVE_DELAY_MINUTES = 2;

// SQL fragment: true when a report has been resolved long enough to move out
// of the active lists and into the "Resolved reports" section.
const MOVED_TO_RESOLVED =
  "(status = 'Resolved' AND resolved_at IS NOT NULL AND resolved_at <= NOW() - INTERVAL '" +
  RESOLVE_DELAY_MINUTES +
  " minutes')";

// Reports are joined to the reporting user so cards can show a real name and
// profession. Legacy rows (no user_id) simply have null reporter_* fields.
const REPORT_SELECT =
  "SELECT r.id, r.category, r.description, r.location, r.priority, r.department, r.reporter, r.identity_mode, r.status, r.feeling, r.acknowledged_at, r.acknowledged_by, r.response_note, r.outcome, r.created_at, r.resolved_at, r.user_id, r.hospital_id, r.assigned_to, r.assigned_at, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name, u.profession AS reporter_profession, u.avatar AS reporter_avatar, au.first_name AS assignee_first_name, au.last_name AS assignee_last_name, au.profession AS assignee_profession, au.avatar AS assignee_avatar, (SELECT COUNT(*)::int FROM report_updates up WHERE up.report_id = r.id) AS update_count FROM reports r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users au ON au.id = r.assigned_to";

async function fetchReportById(id) {
  const r = await pool.query(REPORT_SELECT + " WHERE r.id = $1", [id]);
  return r.rows[0] || null;
}

// --- Server-Sent Events: notify every connected client about emergencies ---
let sseClients = [];

// Broadcast an event to connected clients. When hospitalId is given, only
// clients in that hospital receive it (so emergencies don't leak across
// departments); null/undefined broadcasts to everyone.
function broadcast(event, hospitalId) {
  const payload = "data: " + JSON.stringify(event) + "\n\n";
  sseClients.forEach(function (client) {
    if (hospitalId != null && client.hospitalId !== hospitalId) return;
    try {
      client.write(payload);
    } catch (e) {
      /* client will be cleaned up on close */
    }
  });
}

// Presence helpers, derived from the live SSE connections. `c.userId` and
// `c.hospitalId` are stamped when the stream opens (and `c.hospitalId` is
// re-tagged on department switch), so these always reflect who is actually
// online right now and which department they are in.
function onlineUserIdsInHospital(hospId) {
  const ids = new Set();
  sseClients.forEach(function (c) {
    if (c.userId && c.hospitalId === hospId) ids.add(c.userId);
  });
  return ids;
}
function isUserOnlineInHospital(userId, hospId) {
  return sseClients.some(function (c) {
    return c.userId === userId && c.hospitalId === hospId;
  });
}
// Push an event to every live SSE connection belonging to any of the given user
// ids (used for direct/group messages, which target people, not a department).
function broadcastToUsers(event, userIds) {
  const set = new Set(userIds);
  const payload = "data: " + JSON.stringify(event) + "\n\n";
  sseClients.forEach(function (c) {
    if (c.userId && set.has(c.userId)) {
      try {
        c.write(payload);
      } catch (e) {
        /* client will be cleaned up on close */
      }
    }
  });
}

// --------------------- Availability & auto-allocation ---------------------

// Given a list of user rows ({id, availability_status}), return the set of ids
// who are effectively "free" right now. A time window covering now wins (a busy
// window beats a free one on overlap); with no covering window we fall back to
// the user's current availability_status (which defaults to 'free').
async function effectiveFreeUserIds(userRows) {
  if (!userRows.length) return new Set();
  const ids = userRows.map((u) => u.id);
  const win = await pool.query(
    `SELECT user_id, status FROM availability
     WHERE user_id = ANY($1::int[])
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())`,
    [ids]
  );
  const busy = new Set();
  const freeWin = new Set();
  win.rows.forEach((w) => {
    if (w.status === "busy") busy.add(w.user_id);
    else freeWin.add(w.user_id);
  });
  const free = new Set();
  userRows.forEach((u) => {
    let eff;
    if (busy.has(u.id)) eff = "busy";
    else if (freeWin.has(u.id)) eff = "free";
    else eff = u.availability_status || "free";
    if (eff === "free") free.add(u.id);
  });
  return free;
}

// Pick the best free colleague to own a new report in a hospital. Candidates are
// people in that department (home hospital) or currently signed in there, whose
// effective availability is "free". We prefer someone other than the reporter,
// then someone online, then whoever has the fewest active assignments (simple
// load-balancing). Returns a user id, or null when nobody is free → Open Reports.
async function pickAssignee(hospId, reporterId, category) {
  if (!hospId) return null;
  const onlineIds = onlineUserIdsInHospital(hospId);
  const online = Array.from(onlineIds);
  const cand = await pool.query(
    `SELECT id, availability_status, profession FROM users
     WHERE hospital_id = $1 OR id = ANY($2::int[])`,
    [hospId, online]
  );
  const freeIds = await effectiveFreeUserIds(cand.rows);
  let candidates = cand.rows.filter((u) => freeIds.has(u.id));
  if (!candidates.length) return null;
  // Prefer a free colleague whose profession handles this category. If none of
  // the matching profession is free, fall back to the whole free pool so the
  // report still gets an owner rather than being left unallocated.
  const required = (CATEGORY_PROFESSIONS[category] || []).map((p) => p.toLowerCase());
  if (required.length) {
    const matched = candidates.filter(
      (u) => u.profession && required.includes(u.profession.trim().toLowerCase())
    );
    if (matched.length) candidates = matched;
  }
  const load = await pool.query(
    `SELECT assigned_to, COUNT(*)::int AS n FROM reports
     WHERE assigned_to = ANY($1::int[]) AND status <> 'Resolved'
     GROUP BY assigned_to`,
    [candidates.map((u) => u.id)]
  );
  const loadMap = {};
  load.rows.forEach((r) => {
    loadMap[r.assigned_to] = r.n;
  });
  candidates.sort((a, b) => {
    const ar = a.id === reporterId ? 1 : 0;
    const br = b.id === reporterId ? 1 : 0;
    if (ar !== br) return ar - br; // not-the-reporter first
    const ao = onlineIds.has(a.id) ? 0 : 1;
    const bo = onlineIds.has(b.id) ? 0 : 1;
    if (ao !== bo) return ao - bo; // online first
    return (loadMap[a.id] || 0) - (loadMap[b.id] || 0); // lightest load
  });
  return candidates[0].id;
}

// ---------------------------- Accounts / auth ----------------------------

// Register a new account and sign in.
app.post("/api/register", async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const profession = String(body.profession || "").trim();

    if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (password.length < MIN_PASSWORD) {
      return res
        .status(400)
        .json({ error: "Password must be at least " + MIN_PASSWORD + " characters." });
    }
    if (password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: "Password is too long." });
    }
    if (!firstName || firstName.length > MAX_NAME) {
      return res.status(400).json({ error: "Please enter your first name." });
    }
    if (!lastName || lastName.length > MAX_NAME) {
      return res.status(400).json({ error: "Please enter your last name." });
    }
    if (!profession || profession.length > MAX_PROFESSION) {
      return res.status(400).json({ error: "Please enter your profession / role." });
    }

    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rowCount > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    // New accounts join the first (default) hospital; they can switch later.
    const defHosp = await pool.query("SELECT id FROM hospitals ORDER BY id LIMIT 1");
    const hospitalId = defHosp.rows[0] ? defHosp.rows[0].id : null;

    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, profession, hospital_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [email, hashPassword(password), firstName, lastName, profession, hospitalId]
    );
    req.session.userId = inserted.rows[0].id;
    req.session.activeHospitalId = hospitalId;
    const user = await fetchUserById(inserted.rows[0].id);
    res.status(201).json(withActive(user, req));
  } catch (err) {
    if (err && err.code === "23505") {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }
    console.error("Error registering:", err);
    res.status(500).json({ error: "Could not create your account." });
  }
});

// Sign in to an existing account.
app.post("/api/login", async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    const result = await pool.query(
      "SELECT id, password_hash, hospital_id FROM users WHERE email = $1",
      [email]
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    req.session.userId = row.id;
    req.session.activeHospitalId = row.hospital_id;
    const user = await fetchUserById(row.id);
    res.json(withActive(user, req));
  } catch (err) {
    console.error("Error logging in:", err);
    res.status(500).json({ error: "Could not sign you in." });
  }
});

// Sign out.
app.post("/api/logout", (req, res) => {
  req.session.destroy(function () {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// Who am I? Used on load to decide whether to show the app or the sign-in screen.
app.get("/api/me", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not signed in." });
  }
  try {
    const user = await fetchUserById(req.session.userId);
    if (!user) {
      req.session.destroy(function () {});
      return res.status(401).json({ error: "Not signed in." });
    }
    res.json(withActive(user, req));
  } catch (err) {
    console.error("Error loading current user:", err);
    res.status(500).json({ error: "Could not load your account." });
  }
});

// Update the signed-in user's profile and preferences. Every field is optional;
// only the ones supplied (and valid) are changed.
app.patch("/api/me", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    const add = function (col, val) {
      params.push(val);
      sets.push(col + " = $" + params.length);
    };

    if (body.voice_autostart !== undefined) {
      if (typeof body.voice_autostart !== "boolean") {
        return res.status(400).json({ error: "voice_autostart must be a boolean." });
      }
      add("voice_autostart", body.voice_autostart);
    }
    if (body.dark_mode !== undefined) {
      if (typeof body.dark_mode !== "boolean") {
        return res.status(400).json({ error: "dark_mode must be a boolean." });
      }
      add("dark_mode", body.dark_mode);
    }
    if (body.first_name !== undefined) {
      const v = String(body.first_name || "").trim();
      if (!v || v.length > MAX_NAME) {
        return res.status(400).json({ error: "Please enter a valid first name." });
      }
      add("first_name", v);
    }
    if (body.last_name !== undefined) {
      const v = String(body.last_name || "").trim();
      if (!v || v.length > MAX_NAME) {
        return res.status(400).json({ error: "Please enter a valid last name." });
      }
      add("last_name", v);
    }
    if (body.profession !== undefined) {
      const v = String(body.profession || "").trim();
      if (!v || v.length > MAX_PROFESSION) {
        return res.status(400).json({ error: "Please enter a valid profession / role." });
      }
      add("profession", v);
    }
    if (body.alias !== undefined) {
      const v = body.alias === null ? null : String(body.alias).trim();
      if (v && v.length > MAX_ALIAS) {
        return res.status(400).json({ error: "Alias is too long." });
      }
      add("alias", v || null);
    }
    if (body.theme_color !== undefined) {
      const v = String(body.theme_color || "");
      if (!THEME_COLORS.includes(v)) {
        return res.status(400).json({ error: "Invalid theme colour." });
      }
      add("theme_color", v);
    }
    if (body.font_scale !== undefined) {
      const v = String(body.font_scale || "");
      if (!FONT_SCALES.includes(v)) {
        return res.status(400).json({ error: "Invalid font size." });
      }
      add("font_scale", v);
    }
    if (body.avatar !== undefined) {
      if (body.avatar === null || body.avatar === "") {
        add("avatar", null);
      } else {
        const v = String(body.avatar);
        if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(v)) {
          return res.status(400).json({ error: "Profile picture must be an image." });
        }
        if (v.length > MAX_AVATAR) {
          return res.status(400).json({ error: "Profile picture is too large (max ~1 MB)." });
        }
        add("avatar", v);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    params.push(req.user.id);
    await pool.query(
      "UPDATE users SET " + sets.join(", ") + " WHERE id = $" + params.length,
      params
    );
    const user = await fetchUserById(req.user.id);
    res.json(withActive(user, req));
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: "Could not save your changes." });
  }
});

// -------------------------- Hospitals & staff ---------------------------

// List hospitals, each with its staff (name, role, avatar, online status) and
// its password (shown for now to demo the department-switch flow).
app.get("/api/hospitals", requireAuth, async (req, res) => {
  try {
    const hospitals = await pool.query(
      "SELECT id, name, password FROM hospitals ORDER BY name ASC"
    );
    const staff = await pool.query(
      "SELECT id, first_name, last_name, profession, alias, avatar, hospital_id, access_level FROM users ORDER BY first_name ASC, last_name ASC"
    );
    const activeId = activeHospitalId(req);
    const byHospital = {};
    staff.rows.forEach(function (u) {
      const list = byHospital[u.hospital_id] || (byHospital[u.hospital_id] = []);
      list.push({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        profession: u.profession,
        alias: u.alias,
        avatar: u.avatar,
        access_level: u.access_level,
        online: isUserOnlineInHospital(u.id, u.hospital_id),
      });
    });
    res.json(
      hospitals.rows.map(function (h) {
        // Only reveal a hospital's staff roster to members of that hospital
        // (i.e. the viewer's own/active department). Others see the hospital
        // and its switch password, but not who works there.
        const isMine = h.id === activeId;
        return {
          id: h.id,
          name: h.name,
          // Passwords are only revealed to admins (shown in the admin panel).
          password: req.user.is_admin ? h.password : undefined,
          is_home: h.id === req.user.hospital_id,
          is_active: h.id === activeId,
          staff: isMine ? byHospital[h.id] || [] : [],
          staff_count: (byHospital[h.id] || []).length,
        };
      })
    );
  } catch (err) {
    console.error("Error listing hospitals:", err);
    res.status(500).json({ error: "Could not load hospitals." });
  }
});

// Switch the active department. Requires the destination hospital's password.
app.post("/api/hospitals/:id/switch", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid hospital id." });
    }
    const id = parseInt(req.params.id, 10);
    const password = String((req.body || {}).password || "");
    const r = await pool.query("SELECT id, name, password FROM hospitals WHERE id = $1", [id]);
    const hospital = r.rows[0];
    if (!hospital) {
      return res.status(404).json({ error: "Hospital not found." });
    }
    if (password !== hospital.password) {
      return res.status(403).json({ error: "Incorrect password for that hospital." });
    }
    req.session.activeHospitalId = id;
    // Re-tag any live SSE connections for this user so emergency broadcasts
    // follow them to the new department (no stale cross-hospital events).
    sseClients.forEach(function (c) {
      if (c.userId === req.user.id) c.hospitalId = id;
    });
    res.json({ ok: true, active_hospital_id: id, name: hospital.name });
  } catch (err) {
    console.error("Error switching hospital:", err);
    res.status(500).json({ error: "Could not switch hospital." });
  }
});

// Live staff list: everyone who is actually signed in right now (real presence).
app.get("/api/staff", requireAuth, async (req, res) => {
  try {
    // Only show staff from the viewer's own hospital. Not part of a hospital
    // means no staff roster is shown.
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json([]);
    // Everyone who belongs to this department (home hospital) OR is currently
    // signed in here (live SSE presence, so colleagues who switched in show up).
    // Offline home-hospital staff are included too, each flagged online/offline.
    const onlineIds = onlineUserIdsInHospital(hospId);
    const r = await pool.query(
      USER_SELECT +
        " WHERE u.hospital_id = $1 OR u.id = ANY($2) ORDER BY u.first_name ASC, u.last_name ASC",
      [hospId, Array.from(onlineIds)]
    );
    const myRank = accessRank(req.user);
    res.json(
      r.rows.map(function (u) {
        return {
          id: u.id,
          first_name: u.first_name,
          last_name: u.last_name,
          profession: u.profession,
          alias: u.alias,
          avatar: u.avatar,
          hospital_name: u.hospital_name,
          access_level: u.access_level,
          is_admin: u.is_admin,
          online: onlineIds.has(u.id),
          is_me: u.id === req.user.id,
          // Can the viewer manage this row via PATCH /api/staff/:id? Mirrors the
          // endpoint's own guards so switched-in colleagues (home elsewhere)
          // don't get a manage UI that would just 404.
          manageable:
            myRank >= 1 &&
            u.id !== req.user.id &&
            u.hospital_id === hospId &&
            myRank > accessRank(u),
        };
      })
    );
  } catch (err) {
    console.error("Error listing staff:", err);
    res.status(500).json({ error: "Could not load staff." });
  }
});

// Add a member to the caller's active department. IT and IT Lead only. New
// accounts always start as a plain member (the roster manager can promote them
// afterwards). Reuses the registration validation rules.
app.post("/api/staff", requireAuth, async (req, res) => {
  try {
    if (accessRank(req.user) < 1) {
      return res.status(403).json({ error: "You don't have permission to add members." });
    }
    const hospId = activeHospitalId(req);
    if (!hospId) return res.status(400).json({ error: "You're not in a department." });
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const profession = String(body.profession || "").trim();

    if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (password.length < MIN_PASSWORD) {
      return res
        .status(400)
        .json({ error: "Password must be at least " + MIN_PASSWORD + " characters." });
    }
    if (password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: "Password is too long." });
    }
    if (!firstName || firstName.length > MAX_NAME) {
      return res.status(400).json({ error: "Please enter a first name." });
    }
    if (!lastName || lastName.length > MAX_NAME) {
      return res.status(400).json({ error: "Please enter a last name." });
    }
    if (!profession || profession.length > MAX_PROFESSION) {
      return res.status(400).json({ error: "Please choose a profession / role." });
    }

    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rowCount > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, profession, hospital_id, access_level)
       VALUES ($1, $2, $3, $4, $5, $6, 'member')
       RETURNING id`,
      [email, hashPassword(password), firstName, lastName, profession, hospId]
    );
    const u = await fetchUserById(inserted.rows[0].id);
    res.status(201).json({
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      profession: u.profession,
      access_level: u.access_level,
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }
    console.error("Error adding member:", err);
    res.status(500).json({ error: "Could not add the member." });
  }
});

// Manage a member in the caller's active department.
//  - IT and IT Lead can change a member's profession.
//  - IT Lead (and admin) can also change a member's access level (role).
// You may only manage someone strictly below your own rank, and only grant a
// role below your own rank — so IT can't touch other IT/leads, IT Lead can
// promote members to IT but not mint another lead, and no one edits themselves
// here (use PATCH /api/me for your own profile).
app.patch("/api/staff/:id", requireAuth, async (req, res) => {
  try {
    const actorRank = accessRank(req.user);
    if (actorRank < 1) {
      return res.status(403).json({ error: "You don't have permission to manage members." });
    }
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid member id." });
    }
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: "You can't change your own role here." });
    }
    const hospId = activeHospitalId(req);
    if (!hospId) return res.status(400).json({ error: "You're not in a department." });
    const target = await fetchUserById(targetId);
    if (!target || target.hospital_id !== hospId) {
      return res.status(404).json({ error: "Member not found in your department." });
    }
    if (actorRank <= accessRank(target)) {
      return res.status(403).json({ error: "You can't manage someone at or above your level." });
    }

    const body = req.body || {};
    const sets = [];
    const params = [];
    const add = function (col, val) {
      params.push(val);
      sets.push(col + " = $" + params.length);
    };

    if (body.profession !== undefined) {
      const v = String(body.profession || "").trim();
      if (!v || v.length > MAX_PROFESSION) {
        return res.status(400).json({ error: "Please choose a valid profession / role." });
      }
      add("profession", v);
    }
    if (body.access_level !== undefined) {
      if (actorRank < 2) {
        return res.status(403).json({ error: "Only an IT Lead can change roles." });
      }
      const lvl = String(body.access_level || "");
      if (!ACCESS_LEVELS.includes(lvl)) {
        return res.status(400).json({ error: "Invalid role." });
      }
      if (ACCESS_LEVELS.indexOf(lvl) >= actorRank) {
        return res.status(403).json({ error: "You can't grant a role at or above your own." });
      }
      add("access_level", lvl);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "Nothing to update." });
    }
    params.push(targetId);
    await pool.query(
      "UPDATE users SET " + sets.join(", ") + " WHERE id = $" + params.length,
      params
    );
    const u = await fetchUserById(targetId);
    res.json({
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      profession: u.profession,
      access_level: u.access_level,
    });
  } catch (err) {
    console.error("Error managing member:", err);
    res.status(500).json({ error: "Could not update the member." });
  }
});

// ----------------------------- Messaging --------------------------------

// Build enriched conversation objects (members, last message, unread count)
// for a set of conversation ids, from the caller's perspective.
async function conversationSummaries(convIds, viewerId) {
  if (!convIds.length) return [];
  const convs = await pool.query(
    "SELECT id, is_group, title, created_by, created_at FROM conversations WHERE id = ANY($1)",
    [convIds]
  );
  const members = await pool.query(
    `SELECT cm.conversation_id, cm.user_id,
            u.first_name, u.last_name, u.profession, u.avatar
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ANY($1)`,
    [convIds]
  );
  const lastMsgs = await pool.query(
    `SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.body, m.created_at, m.user_id,
            u.first_name, u.last_name
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = ANY($1)
      ORDER BY m.conversation_id, m.created_at DESC`,
    [convIds]
  );
  const unread = await pool.query(
    `SELECT m.conversation_id, COUNT(*)::int AS n
       FROM messages m
       JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
      WHERE m.conversation_id = ANY($1)
        AND m.user_id <> $2
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
      GROUP BY m.conversation_id`,
    [convIds, viewerId]
  );
  const membersByConv = {};
  members.rows.forEach(function (m) {
    (membersByConv[m.conversation_id] || (membersByConv[m.conversation_id] = [])).push({
      id: m.user_id,
      first_name: m.first_name,
      last_name: m.last_name,
      profession: m.profession,
      avatar: m.avatar,
    });
  });
  const lastByConv = {};
  lastMsgs.rows.forEach(function (m) {
    lastByConv[m.conversation_id] = {
      body: m.body,
      created_at: m.created_at,
      user_id: m.user_id,
      author: [m.first_name, m.last_name].filter(Boolean).join(" "),
    };
  });
  const unreadByConv = {};
  unread.rows.forEach(function (u) {
    unreadByConv[u.conversation_id] = u.n;
  });
  return convs.rows.map(function (c) {
    return {
      id: c.id,
      is_group: c.is_group,
      title: c.title,
      created_by: c.created_by,
      created_at: c.created_at,
      members: membersByConv[c.id] || [],
      last_message: lastByConv[c.id] || null,
      unread: unreadByConv[c.id] || 0,
    };
  });
}

// Return the conversation row if the user is a member and it's in the given
// (active) hospital; otherwise null. Enforces membership + hospital scoping.
async function memberConversation(convId, userId, hospId) {
  const r = await pool.query(
    `SELECT c.* FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE c.id = $1 AND cm.user_id = $2 AND c.hospital_id = $3`,
    [convId, userId, hospId]
  );
  return r.rows[0] || null;
}

// List the caller's conversations in their active department, newest activity first.
app.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json([]);
    const mine = await pool.query(
      `SELECT c.id FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE cm.user_id = $1 AND c.hospital_id = $2`,
      [req.user.id, hospId]
    );
    const ids = mine.rows.map(function (r) {
      return r.id;
    });
    const list = await conversationSummaries(ids, req.user.id);
    list.sort(function (a, b) {
      const at = a.last_message ? new Date(a.last_message.created_at) : new Date(a.created_at);
      const bt = b.last_message ? new Date(b.last_message.created_at) : new Date(b.created_at);
      return bt - at;
    });
    res.json(list);
  } catch (err) {
    console.error("Error listing conversations:", err);
    res.status(500).json({ error: "Could not load conversations." });
  }
});

// Create a conversation (DM or group). Members must belong to the active dept.
app.post("/api/conversations", requireAuth, async (req, res) => {
  try {
    const hospId = activeHospitalId(req);
    if (!hospId) return res.status(400).json({ error: "Join a department first." });
    const body = req.body || {};
    let memberIds = Array.isArray(body.member_ids) ? body.member_ids : [];
    memberIds = memberIds
      .map(function (n) {
        return parseInt(n, 10);
      })
      .filter(function (n) {
        return Number.isInteger(n) && n !== req.user.id;
      });
    memberIds = Array.from(new Set(memberIds));
    if (!memberIds.length) {
      return res.status(400).json({ error: "Pick at least one person." });
    }
    // Every invited member must belong to (or be online in) this department.
    const onlineIds = onlineUserIdsInHospital(hospId);
    const valid = await pool.query(
      "SELECT id FROM users WHERE id = ANY($1) AND (hospital_id = $2 OR id = ANY($3))",
      [memberIds, hospId, Array.from(onlineIds)]
    );
    const validIds = valid.rows.map(function (r) {
      return r.id;
    });
    if (validIds.length !== memberIds.length) {
      return res.status(400).json({ error: "Some people aren't in this department." });
    }
    const allMembers = [req.user.id].concat(validIds);
    const isGroup = !!body.is_group || validIds.length > 1;
    const title = isGroup ? String(body.title || "").trim().slice(0, 120) : null;

    // For a 1:1 DM, reuse any existing conversation between the two people.
    if (!isGroup && validIds.length === 1) {
      const other = validIds[0];
      const existing = await pool.query(
        `SELECT c.id FROM conversations c
           WHERE c.hospital_id = $1 AND c.is_group = FALSE
             AND (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
             AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = $2)
             AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = $3)
           LIMIT 1`,
        [hospId, req.user.id, other]
      );
      if (existing.rows[0]) {
        const list = await conversationSummaries([existing.rows[0].id], req.user.id);
        return res.json(list[0]);
      }
    }

    const conv = await pool.query(
      `INSERT INTO conversations (hospital_id, is_group, title, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [hospId, isGroup, title, req.user.id]
    );
    const convId = conv.rows[0].id;
    for (const uid of allMembers) {
      await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [convId, uid, uid === req.user.id ? new Date() : null]
      );
    }
    const list = await conversationSummaries([convId], req.user.id);
    // Notify the other members so a new conversation appears live.
    broadcastToUsers({ type: "conversation", conversation_id: convId }, validIds);
    res.status(201).json(list[0]);
  } catch (err) {
    console.error("Error creating conversation:", err);
    res.status(500).json({ error: "Could not start the conversation." });
  }
});

// List messages in a conversation (member-only) and mark them read.
app.get("/api/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    const msgs = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.user_id,
              u.first_name, u.last_name, u.avatar
         FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
      [id]
    );
    await pool.query(
      "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    res.json(
      msgs.rows.map(function (m) {
        return {
          id: m.id,
          body: m.body,
          created_at: m.created_at,
          user_id: m.user_id,
          author: [m.first_name, m.last_name].filter(Boolean).join(" "),
          avatar: m.avatar,
          is_me: m.user_id === req.user.id,
        };
      })
    );
  } catch (err) {
    console.error("Error loading messages:", err);
    res.status(500).json({ error: "Could not load messages." });
  }
});

// Send a message to a conversation (member-only) and notify members via SSE.
app.post("/api/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    const bodyText = String((req.body || {}).body || "").trim();
    if (!bodyText) return res.status(400).json({ error: "Message can't be empty." });
    if (bodyText.length > 4000) return res.status(400).json({ error: "Message is too long." });
    const inserted = await pool.query(
      `INSERT INTO messages (conversation_id, user_id, body)
       VALUES ($1, $2, $3) RETURNING id, created_at`,
      [id, req.user.id, bodyText]
    );
    await pool.query(
      "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    const message = {
      id: inserted.rows[0].id,
      conversation_id: id,
      body: bodyText,
      created_at: inserted.rows[0].created_at,
      user_id: req.user.id,
      author: fullName(req.user),
      avatar: req.user.avatar,
    };
    const memberRows = await pool.query(
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1",
      [id]
    );
    const memberIds = memberRows.rows.map(function (r) {
      return r.user_id;
    });
    broadcastToUsers({ type: "message", conversation_id: id, message: message }, memberIds);
    res.status(201).json(Object.assign({ is_me: true }, message));
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ error: "Could not send the message." });
  }
});

// --------------------------- AI assistant -------------------------------

// A fresh OpenAI client per call (tokens/keys are injected by Replit AI
// Integrations via env vars; never cache the client).
function getOpenAIClient() {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) return null;
  return new OpenAI({ baseURL: baseURL, apiKey: apiKey });
}

const ASSIST_SYSTEM_PROMPT =
  "You are a warm, brisk assistant helping busy UK healthcare ward staff log a " +
  "'friction' report (everyday things that slow them down: missing linen, broken " +
  "kit, slow computers, waiting on porters, etc.). Your job is to gather a clear, " +
  "complete report by asking ONE short follow-up question at a time about whatever " +
  "important detail is still missing or vague. Priorities for completeness: (1) what " +
  "the problem is, (2) the location/ward/bay, (3) how urgent it is. Feeling is " +
  "optional — ask at most once and never insist. Keep questions to one sentence, " +
  "plain, friendly, no jargon. Never ask for patient-identifiable information. " +
  "When you have enough for a useful report, stop asking and set complete=true with a " +
  "brief encouraging closing message. " +
  "Category must be EXACTLY one of: " + CATEGORIES.join("; ") + ". " +
  "Priority must be one of: Low, Medium, High. Never choose Emergency (that is a " +
  "deliberate manual choice the person makes themselves). " +
  "Feeling, if clearly expressed, must be one of: " + FEELINGS.join(", ") + ". " +
  "Department is OPTIONAL — only include it if the person clearly designates a " +
  "department to handle the issue; never ask for it. If included, it must be EXACTLY " +
  "one of: " + DEPARTMENTS.join("; ") + ". " +
  "Always respond with a JSON object with keys: reply (string, your next question or " +
  "closing message), extracted (object with any of: category, location, priority, " +
  "feeling, department — include a key ONLY when you are confident from the " +
  "conversation), and complete (boolean).";

app.post("/api/assist", requireAuth, async (req, res) => {
  const client = getOpenAIClient();
  if (!client) {
    return res.status(503).json({
      error: "The AI assistant isn't connected yet. Please try again later.",
    });
  }
  try {
    const body = req.body || {};
    const description = String(body.description || "").trim().slice(0, MAX_DESCRIPTION);
    if (!description) {
      return res.status(400).json({ error: "Describe the issue first." });
    }
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

    const contextLines = [
      "Here is the report so far.",
      "Description: " + description,
      "Category: " + (fields.category || "(not set)"),
      "Location: " + (fields.location || "(not set)"),
      "Priority: " + (fields.priority || "(not set)"),
      "Feeling: " + (fields.feeling || "(not set)"),
      "Department: " + (fields.department || "(not set)"),
    ];

    const messages = [
      { role: "system", content: ASSIST_SYSTEM_PROMPT },
      { role: "system", content: contextLines.join("\n") },
    ];
    history.forEach(function (m) {
      if (!m || typeof m.content !== "string") return;
      const role = m.role === "assistant" ? "assistant" : "user";
      messages.push({ role: role, content: m.content.slice(0, 1000) });
    });

    const completion = await client.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: messages,
      response_format: { type: "json_object" },
      max_completion_tokens: 8192,
    });

    let parsed = {};
    try {
      parsed = JSON.parse(completion.choices[0].message.content || "{}");
    } catch (e) {
      parsed = {};
    }

    // Validate the model's suggestions against our allowlists before returning.
    const extractedIn =
      parsed.extracted && typeof parsed.extracted === "object" ? parsed.extracted : {};
    const extracted = {};
    if (extractedIn.category && CATEGORIES.includes(String(extractedIn.category))) {
      extracted.category = String(extractedIn.category);
    }
    if (extractedIn.location) {
      extracted.location = String(extractedIn.location).trim().slice(0, MAX_LOCATION);
    }
    const p = String(extractedIn.priority || "");
    if (["Low", "Medium", "High"].includes(p)) {
      extracted.priority = p;
    }
    if (extractedIn.feeling && FEELINGS.includes(String(extractedIn.feeling))) {
      extracted.feeling = String(extractedIn.feeling);
    }
    if (extractedIn.department && DEPARTMENTS.includes(String(extractedIn.department))) {
      extracted.department = String(extractedIn.department);
    }

    res.json({
      reply: String(parsed.reply || "Anything else you'd like to add?").slice(0, 800),
      extracted: extracted,
      complete: parsed.complete === true,
    });
  } catch (err) {
    console.error("AI assist error:", err && err.message ? err.message : err);
    res.status(502).json({
      error: "The assistant had trouble responding. You can keep filling in the form.",
    });
  }
});

// ------------------------------- Reports --------------------------------

// Create a new report (attributed to the signed-in user).
app.post("/api/reports", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const category = String(body.category || "").trim();
    const description = String(body.description || "").trim();
    const location = body.location ? String(body.location).trim() : null;
    let priority = String(body.priority || "Medium").trim();
    let feeling = body.feeling ? String(body.feeling).trim() : null;
    // Optional department designation; ignore anything not on the allowlist.
    let department = body.department ? String(body.department).trim() : null;

    if (!category || !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "A valid category is required." });
    }
    if (!description) {
      return res.status(400).json({ error: "A description is required." });
    }
    if (description.length > MAX_DESCRIPTION) {
      return res
        .status(400)
        .json({ error: "Description is too long (max " + MAX_DESCRIPTION + " characters)." });
    }
    if (location && location.length > MAX_LOCATION) {
      return res
        .status(400)
        .json({ error: "Location is too long (max " + MAX_LOCATION + " characters)." });
    }
    if (!PRIORITIES.includes(priority)) {
      priority = "Medium";
    }
    // Feeling is optional; ignore anything not on the allowlist.
    if (feeling && !FEELINGS.includes(feeling)) {
      feeling = null;
    }
    // Department is optional; ignore anything not on the allowlist.
    if (department && !DEPARTMENTS.includes(department)) {
      department = null;
    }

    // Tie the report to the hospital the reporter is currently working in, so
    // reports stay specialised to their department.
    const hospitalId = activeHospitalId(req);
    // Auto-allocate to a colleague who is free right now; null → Open Reports.
    const assignee = await pickAssignee(hospitalId, req.user.id, category);
    const inserted = await pool.query(
      `INSERT INTO reports (category, description, location, priority, feeling, department, user_id, hospital_id, assigned_to, assigned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() END)
       RETURNING id`,
      [category, description, location, priority, feeling, department, req.user.id, hospitalId, assignee]
    );
    const report = await fetchReportById(inserted.rows[0].id);
    if (report.priority === "Emergency") {
      broadcast({ type: "emergency", report: report }, report.hospital_id);
    }
    res.status(201).json(report);
  } catch (err) {
    console.error("Error creating report:", err);
    res.status(500).json({ error: "Could not save report." });
  }
});

// List reports. Optional filters: status, priority, category.
// Optional sort: "urgency" (Emergency > High > Medium > Low, then newest) or "recent".
// Optional bucket: "active" (default, hides long-resolved) or "resolved"
// (only reports resolved for RESOLVE_DELAY_MINUTES+).
app.get("/api/reports", requireAuth, async (req, res) => {
  try {
    // Reports are specialised to the viewer's hospital. Not part of a hospital
    // means no reports are shown at all.
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json([]);

    const { status, priority, category, sort, bucket } = req.query;
    const conditions = [];
    const params = [];

    params.push(hospId);
    conditions.push("r.hospital_id = $" + params.length);

    if (status && STATUSES.includes(status)) {
      params.push(status);
      conditions.push("r.status = $" + params.length);
    }
    if (priority && PRIORITIES.includes(priority)) {
      params.push(priority);
      conditions.push("r.priority = $" + params.length);
    }
    if (category && CATEGORIES.includes(category)) {
      params.push(category);
      conditions.push("r.category = $" + params.length);
    }

    if (bucket === "resolved") {
      conditions.push(MOVED_TO_RESOLVED);
    } else if (bucket === "open") {
      // Open Reports: waiting for a free person — unassigned + still active.
      conditions.push("r.assigned_to IS NULL");
      conditions.push("NOT " + MOVED_TO_RESOLVED);
    } else if (bucket === "allocated") {
      // Allocated Reports: already assigned to a colleague + still active.
      conditions.push("r.assigned_to IS NOT NULL");
      conditions.push("NOT " + MOVED_TO_RESOLVED);
    } else {
      conditions.push("NOT " + MOVED_TO_RESOLVED);
    }

    let query = REPORT_SELECT;
    if (conditions.length) {
      query += " WHERE " + conditions.join(" AND ");
    }

    if (bucket === "resolved") {
      // Most recently resolved first.
      query += " ORDER BY r.resolved_at DESC LIMIT 500";
    } else if (sort === "urgency") {
      // "All reports" view — every active report, highest urgency first.
      query +=
        " ORDER BY CASE r.priority WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, r.created_at DESC";
    } else {
      // "Recent reports" view — emergencies pinned to the top, then newest.
      query +=
        " ORDER BY CASE WHEN r.priority = 'Emergency' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100";
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing reports:", err);
    res.status(500).json({ error: "Could not load reports." });
  }
});

// Server-Sent Events stream for real-time emergency notifications.
app.get("/api/events", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  // Tag the connection with the viewer and their current hospital so emergency
  // broadcasts stay within their department. The hospital tag is refreshed if
  // the user switches departments mid-session (see the switch endpoint).
  res.userId = req.user.id;
  res.hospitalId = activeHospitalId(req);
  // Adding this stream to sseClients is what marks the user online (presence is
  // derived from live connections); removing it on close marks them offline.
  sseClients.push(res);

  const keepAlive = setInterval(function () {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      /* handled on close */
    }
  }, 25000);

  req.on("close", function () {
    clearInterval(keepAlive);
    sseClients = sseClients.filter(function (c) {
      return c !== res;
    });
  });
});

// Update a report's status and/or priority.
app.patch("/api/reports/:id", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};

    const sets = [];
    const params = [];
    let raisedEmergency = false;

    if (body.status !== undefined) {
      const status = String(body.status).trim();
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status." });
      }
      params.push(status);
      sets.push("status = $" + params.length);
      // Track when a report becomes resolved so it can move to the resolved
      // section; clear the timestamp whenever it's re-opened (unresolved).
      sets.push(status === "Resolved" ? "resolved_at = NOW()" : "resolved_at = NULL");
    }

    if (body.priority !== undefined) {
      const priority = String(body.priority).trim();
      if (!PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: "Invalid priority." });
      }
      params.push(priority);
      sets.push("priority = $" + params.length);
      if (priority === "Emergency") raisedEmergency = true;
    }

    // Acknowledgement / response: lets a reviewer record that a report has been
    // seen and, optionally, who acknowledged it and a short reply. Passing
    // acknowledged:false clears the acknowledgement.
    if (body.acknowledged !== undefined) {
      if (typeof body.acknowledged !== "boolean") {
        return res
          .status(400)
          .json({ error: "acknowledged must be true or false." });
      }
      if (body.acknowledged) {
        sets.push("acknowledged_at = NOW()");

        // The reviewer is always the signed-in user; ignore any client name.
        params.push(fullName(req.user));
        sets.push("acknowledged_by = $" + params.length);

        const note = body.response_note
          ? String(body.response_note).trim()
          : null;
        if (note && note.length > MAX_RESPONSE) {
          return res
            .status(400)
            .json({ error: "Response is too long (max " + MAX_RESPONSE + " characters)." });
        }
        params.push(note || null);
        sets.push("response_note = $" + params.length);
      } else {
        sets.push("acknowledged_at = NULL");
        sets.push("acknowledged_by = NULL");
        sets.push("response_note = NULL");
      }
    }

    // Outcome: a visible record of what was actually done about the report,
    // usually captured when it is resolved. Passing null/"" clears it.
    if (body.outcome !== undefined) {
      const outcome =
        body.outcome === null ? null : String(body.outcome).trim();
      if (outcome && outcome.length > MAX_OUTCOME) {
        return res
          .status(400)
          .json({ error: "Outcome is too long (max " + MAX_OUTCOME + " characters)." });
      }
      params.push(outcome || null);
      sets.push("outcome = $" + params.length);
    }

    // Claim / release: a staff member can claim an Open report (assign it to
    // themselves) or release one back to Open. To avoid cross-user tampering we
    // only allow assigning to self (claim) or clearing (release).
    if (body.assigned_to !== undefined) {
      if (body.assigned_to === null) {
        sets.push("assigned_to = NULL");
        sets.push("assigned_at = NULL");
      } else {
        const aid = parseInt(body.assigned_to, 10);
        if (!Number.isInteger(aid) || aid !== req.user.id) {
          return res
            .status(400)
            .json({ error: "You can only claim a report for yourself." });
        }
        params.push(aid);
        sets.push("assigned_to = $" + params.length);
        sets.push("assigned_at = NOW()");
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    // Only allow updating reports that belong to the viewer's hospital.
    const hospId = activeHospitalId(req);
    if (!hospId) {
      return res.status(404).json({ error: "Report not found." });
    }
    params.push(id);
    const idParam = params.length;
    params.push(hospId);
    const updated = await pool.query(
      "UPDATE reports SET " + sets.join(", ") + " WHERE id = $" + idParam +
        " AND hospital_id = $" + params.length + " RETURNING id",
      params
    );
    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    const report = await fetchReportById(id);
    if (raisedEmergency) {
      broadcast({ type: "emergency", report: report }, report.hospital_id);
    }
    res.json(report);
  } catch (err) {
    console.error("Error updating report:", err);
    res.status(500).json({ error: "Could not update report." });
  }
});

// List a report's progress updates (oldest first) so staff can follow progress.
app.get("/api/reports/:id/updates", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    // Only expose updates for reports in the viewer's hospital.
    const hospId = activeHospitalId(req);
    const owner = await pool.query(
      "SELECT id FROM reports WHERE id = $1 AND hospital_id = $2",
      [id, hospId]
    );
    if (owner.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    const result = await pool.query(
      "SELECT id, report_id, note, author, created_at FROM report_updates WHERE report_id = $1 ORDER BY created_at ASC",
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing updates:", err);
    res.status(500).json({ error: "Could not load updates." });
  }
});

// Add a timestamped progress update to a report.
app.post("/api/reports/:id/updates", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const note = String(body.note || "").trim();
    // The author is always the signed-in user; ignore any client-supplied name.
    const author = fullName(req.user);

    if (!note) {
      return res.status(400).json({ error: "An update note is required." });
    }
    if (note.length > MAX_UPDATE) {
      return res
        .status(400)
        .json({ error: "Update is too long (max " + MAX_UPDATE + " characters)." });
    }

    // Only allow adding updates to reports in the viewer's hospital.
    const hospId = activeHospitalId(req);
    const exists = await pool.query(
      "SELECT id FROM reports WHERE id = $1 AND hospital_id = $2",
      [id, hospId]
    );
    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }

    const result = await pool.query(
      "INSERT INTO report_updates (report_id, note, author) VALUES ($1, $2, $3) RETURNING id, report_id, note, author, created_at",
      [id, note, author]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error adding update:", err);
    res.status(500).json({ error: "Could not add update." });
  }
});

// Aggregate insights for organisational learning: volumes, feelings, and how
// long things take to resolve.
app.get("/api/insights", requireAuth, async (req, res) => {
  try {
    // Insights are scoped to the viewer's hospital. Not part of a hospital
    // means empty aggregates.
    const hospId = activeHospitalId(req);
    if (!hospId) {
      return res.json({
        totals: { total: 0, open: 0, in_progress: 0, resolved: 0, emergencies: 0, acknowledged: 0 },
        byCategory: [],
        byFeeling: [],
        byPriority: [],
        feelingTrend: [],
        avgResolveMinutes: null,
        acknowledgedRate: 0,
        updatesTotal: 0,
      });
    }
    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'Open')::int AS open,
         COUNT(*) FILTER (WHERE status = 'In progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE priority = 'Emergency')::int AS emergencies,
         COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS acknowledged
       FROM reports WHERE hospital_id = $1`,
      [hospId]
    );
    const byCategory = await pool.query(
      "SELECT category, COUNT(*)::int AS count FROM reports WHERE hospital_id = $1 GROUP BY category ORDER BY count DESC, category ASC",
      [hospId]
    );
    const byFeeling = await pool.query(
      "SELECT feeling, COUNT(*)::int AS count FROM reports WHERE hospital_id = $1 AND feeling IS NOT NULL GROUP BY feeling ORDER BY count DESC",
      [hospId]
    );
    const byPriority = await pool.query(
      "SELECT priority, COUNT(*)::int AS count FROM reports WHERE hospital_id = $1 GROUP BY priority",
      [hospId]
    );
    const resolveTime = await pool.query(
      "SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0) AS avg_minutes FROM reports WHERE hospital_id = $1 AND status = 'Resolved' AND resolved_at IS NOT NULL",
      [hospId]
    );
    const updates = await pool.query(
      "SELECT COUNT(*)::int AS total FROM report_updates up JOIN reports r ON r.id = up.report_id WHERE r.hospital_id = $1",
      [hospId]
    );
    // Emotional-feedback trend: count of feeling-tagged reports per day for the
    // last 14 days, gap-filled so quiet days show as zero (a continuous line).
    const feelingTrend = await pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(c.count, 0)::int AS count
         FROM generate_series(
                date_trunc('day', NOW()) - INTERVAL '13 days',
                date_trunc('day', NOW()),
                INTERVAL '1 day'
              ) AS d(day)
         LEFT JOIN (
           SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
             FROM reports
            WHERE hospital_id = $1 AND feeling IS NOT NULL
            GROUP BY 1
         ) AS c ON c.day = d.day
        ORDER BY d.day`,
      [hospId]
    );

    const t = totals.rows[0];
    const avg = resolveTime.rows[0].avg_minutes;
    res.json({
      totals: t,
      byCategory: byCategory.rows,
      byFeeling: byFeeling.rows,
      byPriority: byPriority.rows,
      feelingTrend: feelingTrend.rows,
      avgResolveMinutes: avg === null ? null : Math.round(Number(avg)),
      acknowledgedRate: t.total ? Math.round((t.acknowledged / t.total) * 100) : 0,
      updatesTotal: updates.rows[0].total,
    });
  } catch (err) {
    console.error("Error building insights:", err);
    res.status(500).json({ error: "Could not load insights." });
  }
});

// -------------------------- Availability / schedule ---------------------------

// My current status + my upcoming/active windows.
app.get("/api/availability", requireAuth, async (req, res) => {
  try {
    const u = await pool.query(
      "SELECT availability_status FROM users WHERE id = $1",
      [req.user.id]
    );
    const w = await pool.query(
      `SELECT id, status, starts_at, ends_at, note FROM availability
       WHERE user_id = $1 AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY starts_at NULLS FIRST, id`,
      [req.user.id]
    );
    res.json({
      status: (u.rows[0] && u.rows[0].availability_status) || "free",
      windows: w.rows,
    });
  } catch (err) {
    console.error("Error loading availability:", err);
    res.status(500).json({ error: "Could not load availability." });
  }
});

// Set my current free/busy status ("I'm free now" / "I'm busy").
app.patch("/api/availability", requireAuth, async (req, res) => {
  try {
    const status = String((req.body || {}).status || "").trim();
    if (!AVAILABILITY_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status must be free or busy." });
    }
    await pool.query("UPDATE users SET availability_status = $1 WHERE id = $2", [
      status,
      req.user.id,
    ]);
    res.json({ status });
  } catch (err) {
    console.error("Error setting availability:", err);
    res.status(500).json({ error: "Could not update availability." });
  }
});

// Add a scheduled free/busy window (from voice or the manual form).
app.post("/api/availability/windows", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const status = String(b.status || "").trim();
    if (!AVAILABILITY_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status must be free or busy." });
    }
    const starts = b.starts_at ? new Date(b.starts_at) : null;
    const ends = b.ends_at ? new Date(b.ends_at) : null;
    if (starts && isNaN(starts.getTime())) {
      return res.status(400).json({ error: "Invalid start time." });
    }
    if (ends && isNaN(ends.getTime())) {
      return res.status(400).json({ error: "Invalid end time." });
    }
    if (!starts && !ends) {
      return res
        .status(400)
        .json({ error: "A window needs a start and/or end time." });
    }
    if (starts && ends && ends <= starts) {
      return res.status(400).json({ error: "End must be after the start." });
    }
    const note = b.note ? String(b.note).slice(0, 200) : null;
    const r = await pool.query(
      `INSERT INTO availability (user_id, status, starts_at, ends_at, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, starts_at, ends_at, note`,
      [req.user.id, status, starts, ends, note]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("Error adding availability window:", err);
    res.status(500).json({ error: "Could not add that window." });
  }
});

// Remove one of my windows.
app.delete("/api/availability/windows/:id", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid id." });
    }
    await pool.query("DELETE FROM availability WHERE id = $1 AND user_id = $2", [
      parseInt(req.params.id, 10),
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error deleting availability window:", err);
    res.status(500).json({ error: "Could not remove that window." });
  }
});

// Team availability: who is free right now in the viewer's active department.
app.get("/api/availability/team", requireAuth, async (req, res) => {
  try {
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json([]);
    const onlineIds = onlineUserIdsInHospital(hospId);
    const online = Array.from(onlineIds);
    const rows = await pool.query(
      `SELECT id, first_name, last_name, profession, avatar, availability_status
       FROM users WHERE hospital_id = $1 OR id = ANY($2::int[])
       ORDER BY first_name, last_name`,
      [hospId, online]
    );
    const freeIds = await effectiveFreeUserIds(rows.rows);
    res.json(
      rows.rows.map((u) => ({
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        profession: u.profession,
        avatar: u.avatar,
        free: freeIds.has(u.id),
        online: onlineIds.has(u.id),
        is_me: u.id === req.user.id,
      }))
    );
  } catch (err) {
    console.error("Error loading team availability:", err);
    res.status(500).json({ error: "Could not load team availability." });
  }
});

// Wipe every report in the Testing Ground department so admins get a clean
// slate. Admin-only; report_updates cascade on delete.
app.post("/api/testing-ground/reset", requireAuth, async (req, res, next) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: "Admins only." });
    }
    const tg = await pool.query("SELECT id FROM hospitals WHERE name = $1", [
      TESTING_GROUND_NAME,
    ]);
    const tgId = tg.rows[0] ? tg.rows[0].id : null;
    if (!tgId) return res.status(404).json({ error: "Testing Ground missing." });
    const del = await pool.query(
      "DELETE FROM reports WHERE hospital_id = $1",
      [tgId]
    );
    res.json({ ok: true, deleted: del.rowCount });
  } catch (err) {
    next(err);
  }
});

async function initSchema() {
  // Hospitals: each has its own staff; switching to another needs its password.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      password VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Seed the demo hospitals (no-op once they exist).
  for (const h of HOSPITAL_SEED) {
    await pool.query(
      "INSERT INTO hospitals (name, password) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
      [h.name, h.password]
    );
  }

  // Accounts: staff sign in with email + password so reports carry a real name.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(200) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name VARCHAR(60) NOT NULL,
      last_name VARCHAR(60) NOT NULL,
      profession VARCHAR(80) NOT NULL,
      voice_autostart BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migration for existing accounts: per-user "start recording on open" pref.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_autostart BOOLEAN NOT NULL DEFAULT FALSE"
  );
  // Migration: profile + personalisation fields, and a home hospital.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS alias VARCHAR(80)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT");
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS hospital_id INTEGER REFERENCES hospitals(id)"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_color VARCHAR(20) NOT NULL DEFAULT '#0f6cbd'"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS font_scale VARCHAR(10) NOT NULL DEFAULT 'medium'"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN NOT NULL DEFAULT FALSE"
  );
  // Migration: flag the shared admin/testing account.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE"
  );
  // Migration: management hierarchy (member < it < it_lead; admin via is_admin).
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'member'"
  );
  // Backfill existing accounts into the default (first) hospital.
  await pool.query(
    "UPDATE users SET hospital_id = (SELECT id FROM hospitals ORDER BY id LIMIT 1) WHERE hospital_id IS NULL"
  );
  // Seed the shared admin account, homed in the Testing Ground department.
  const tg = await pool.query("SELECT id FROM hospitals WHERE name = $1", [
    TESTING_GROUND_NAME,
  ]);
  const testingGroundId = tg.rows[0] ? tg.rows[0].id : null;
  await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, profession, hospital_id, is_admin)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [
      ADMIN_SEED.email,
      hashPassword(ADMIN_SEED.password),
      ADMIN_SEED.first_name,
      ADMIN_SEED.last_name,
      ADMIN_SEED.profession,
      testingGroundId,
    ]
  );
  // Keep the admin flag/home in sync for an already-existing admin row.
  await pool.query(
    "UPDATE users SET is_admin = TRUE, hospital_id = COALESCE(hospital_id, $2) WHERE email = $1",
    [ADMIN_SEED.email, testingGroundId]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200),
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
      department VARCHAR(80),
      reporter VARCHAR(120),
      identity_mode VARCHAR(20) NOT NULL DEFAULT 'anonymous',
      status VARCHAR(20) NOT NULL DEFAULT 'Open',
      feeling VARCHAR(50),
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by VARCHAR(120),
      response_note TEXT,
      outcome TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Timestamped progress updates for each report (the "progress log").
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_updates (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      author VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_report_updates_report_id ON report_updates(report_id)"
  );
  // Migration for existing tables: track when a report was resolved.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
  );
  // Migration for existing tables: reporter feeling + acknowledgement/response.
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS feeling VARCHAR(50)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS department VARCHAR(80)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS acknowledged_by VARCHAR(120)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS response_note TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS outcome TEXT");
  // Migration for existing tables: attribute reports to a signed-in account.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"
  );
  // Migration: specialise reports to the hospital they were reported in.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS hospital_id INTEGER REFERENCES hospitals(id)"
  );
  // Backfill existing reports with the reporter's home hospital so demo data
  // still shows up under a department.
  await pool.query(
    "UPDATE reports r SET hospital_id = u.hospital_id FROM users u WHERE r.user_id = u.id AND r.hospital_id IS NULL"
  );
  // Any remaining unattributed reports go to the default (first) hospital.
  await pool.query(
    "UPDATE reports SET hospital_id = (SELECT id FROM hospitals ORDER BY id LIMIT 1) WHERE hospital_id IS NULL"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_reports_hospital_id ON reports(hospital_id)"
  );
  // Backfill legacy resolved rows so they obey the "move after 2 minutes" rule
  // (without a timestamp they'd stay in the active lists forever).
  await pool.query(
    "UPDATE reports SET resolved_at = created_at WHERE status = 'Resolved' AND resolved_at IS NULL"
  );

  // Schedule / auto-allocation: current free/busy flag per account, the report
  // assignment columns, and the table of scheduled availability windows.
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_status VARCHAR(10) NOT NULL DEFAULT 'free'"
  );
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)"
  );
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports(assigned_to)"
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(10) NOT NULL DEFAULT 'free',
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      note VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_availability_user ON availability(user_id)"
  );

  // Messaging: Teams-style direct messages and groups, scoped to a hospital.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER REFERENCES hospitals(id),
      is_group BOOLEAN NOT NULL DEFAULT FALSE,
      title VARCHAR(120),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id)"
  );
}

initSchema()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Friction Aid server running at http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
