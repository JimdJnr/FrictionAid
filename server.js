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
  "SELECT u.id, u.email, u.first_name, u.last_name, u.profession, u.alias, u.avatar, u.hospital_id, u.theme_color, u.font_scale, u.dark_mode, u.voice_autostart, h.name AS hospital_name FROM users u LEFT JOIN hospitals h ON h.id = u.hospital_id";

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

// Optional emotional impact the reporter can attach to a report.
// Keep this allowlist in sync with FEELINGS in public/app.js.
const FEELINGS = [
  "Frustrated",
  "Embarrassed",
  "Resentful",
  "Undervalued",
  "Helpless",
  "Cynical",
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
];

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
  "SELECT r.id, r.category, r.description, r.location, r.priority, r.reporter, r.identity_mode, r.status, r.feeling, r.acknowledged_at, r.acknowledged_by, r.response_note, r.outcome, r.created_at, r.resolved_at, r.user_id, r.hospital_id, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name, u.profession AS reporter_profession, u.avatar AS reporter_avatar, (SELECT COUNT(*)::int FROM report_updates up WHERE up.report_id = r.id) AS update_count FROM reports r LEFT JOIN users u ON u.id = r.user_id";

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
      "SELECT id, first_name, last_name, profession, alias, avatar, hospital_id FROM users ORDER BY first_name ASC, last_name ASC"
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
          password: h.password,
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
    // Everyone whose *active* department matches the viewer's — derived from
    // live SSE presence — regardless of their home hospital, so colleagues who
    // switched into this section show up.
    const ids = Array.from(onlineUserIdsInHospital(hospId));
    if (ids.length === 0) return res.json([]);
    const r = await pool.query(
      USER_SELECT +
        " WHERE u.id = ANY($1) ORDER BY u.first_name ASC, u.last_name ASC",
      [ids]
    );
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
          is_me: u.id === req.user.id,
        };
      })
    );
  } catch (err) {
    console.error("Error listing staff:", err);
    res.status(500).json({ error: "Could not load staff." });
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
  "Always respond with a JSON object with keys: reply (string, your next question or " +
  "closing message), extracted (object with any of: category, location, priority, " +
  "feeling — include a key ONLY when you are confident from the conversation), and " +
  "complete (boolean).";

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

    // Tie the report to the hospital the reporter is currently working in, so
    // reports stay specialised to their department.
    const hospitalId = activeHospitalId(req);
    const inserted = await pool.query(
      `INSERT INTO reports (category, description, location, priority, feeling, user_id, hospital_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [category, description, location, priority, feeling, req.user.id, hospitalId]
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

    const t = totals.rows[0];
    const avg = resolveTime.rows[0].avg_minutes;
    res.json({
      totals: t,
      byCategory: byCategory.rows,
      byFeeling: byFeeling.rows,
      byPriority: byPriority.rows,
      avgResolveMinutes: avg === null ? null : Math.round(Number(avg)),
      acknowledgedRate: t.total ? Math.round((t.acknowledged / t.total) * 100) : 0,
      updatesTotal: updates.rows[0].total,
    });
  } catch (err) {
    console.error("Error building insights:", err);
    res.status(500).json({ error: "Could not load insights." });
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
  // Backfill existing accounts into the default (first) hospital.
  await pool.query(
    "UPDATE users SET hospital_id = (SELECT id FROM hospitals ORDER BY id LIMIT 1) WHERE hospital_id IS NULL"
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200),
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
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
