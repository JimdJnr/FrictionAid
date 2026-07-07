const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const { Pool } = require("pg");
const PgSession = require("connect-pg-simple")(session);

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET is not set — cannot run without it.");
  process.exit(1);
}

app.use(express.json());

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

// Require a signed-in user and attach their profile as req.user.
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Please sign in." });
  }
  try {
    const r = await pool.query(
      "SELECT id, email, first_name, last_name, profession FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (r.rowCount === 0) {
      req.session.destroy(function () {});
      return res.status(401).json({ error: "Please sign in." });
    }
    req.user = r.rows[0];
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
  "SELECT r.id, r.category, r.description, r.location, r.priority, r.reporter, r.identity_mode, r.status, r.feeling, r.acknowledged_at, r.acknowledged_by, r.response_note, r.outcome, r.created_at, r.resolved_at, r.user_id, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name, u.profession AS reporter_profession, (SELECT COUNT(*)::int FROM report_updates up WHERE up.report_id = r.id) AS update_count FROM reports r LEFT JOIN users u ON u.id = r.user_id";

async function fetchReportById(id) {
  const r = await pool.query(REPORT_SELECT + " WHERE r.id = $1", [id]);
  return r.rows[0] || null;
}

// --- Server-Sent Events: notify every connected client about emergencies ---
let sseClients = [];

function broadcast(event) {
  const payload = "data: " + JSON.stringify(event) + "\n\n";
  sseClients.forEach(function (client) {
    try {
      client.write(payload);
    } catch (e) {
      /* client will be cleaned up on close */
    }
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

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, profession)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, first_name, last_name, profession`,
      [email, hashPassword(password), firstName, lastName, profession]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    res.status(201).json(user);
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
      "SELECT id, email, password_hash, first_name, last_name, profession FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    req.session.userId = user.id;
    res.json({
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      profession: user.profession,
    });
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
    const r = await pool.query(
      "SELECT id, email, first_name, last_name, profession FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (r.rowCount === 0) {
      req.session.destroy(function () {});
      return res.status(401).json({ error: "Not signed in." });
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error("Error loading current user:", err);
    res.status(500).json({ error: "Could not load your account." });
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

    const inserted = await pool.query(
      `INSERT INTO reports (category, description, location, priority, feeling, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [category, description, location, priority, feeling, req.user.id]
    );
    const report = await fetchReportById(inserted.rows[0].id);
    if (report.priority === "Emergency") {
      broadcast({ type: "emergency", report: report });
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
    const { status, priority, category, sort, bucket } = req.query;
    const conditions = [];
    const params = [];

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

    params.push(id);
    const updated = await pool.query(
      "UPDATE reports SET " + sets.join(", ") + " WHERE id = $" + params.length +
        " RETURNING id",
      params
    );
    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    const report = await fetchReportById(id);
    if (raisedEmergency) {
      broadcast({ type: "emergency", report: report });
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

    const exists = await pool.query("SELECT id FROM reports WHERE id = $1", [id]);
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
    const totals = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'Open')::int AS open,
         COUNT(*) FILTER (WHERE status = 'In progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved,
         COUNT(*) FILTER (WHERE priority = 'Emergency')::int AS emergencies,
         COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS acknowledged
       FROM reports`
    );
    const byCategory = await pool.query(
      "SELECT category, COUNT(*)::int AS count FROM reports GROUP BY category ORDER BY count DESC, category ASC"
    );
    const byFeeling = await pool.query(
      "SELECT feeling, COUNT(*)::int AS count FROM reports WHERE feeling IS NOT NULL GROUP BY feeling ORDER BY count DESC"
    );
    const byPriority = await pool.query(
      "SELECT priority, COUNT(*)::int AS count FROM reports GROUP BY priority"
    );
    const resolveTime = await pool.query(
      "SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0) AS avg_minutes FROM reports WHERE status = 'Resolved' AND resolved_at IS NOT NULL"
    );
    const updates = await pool.query("SELECT COUNT(*)::int AS total FROM report_updates");

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
  // Accounts: staff sign in with email + password so reports carry a real name.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(200) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name VARCHAR(60) NOT NULL,
      last_name VARCHAR(60) NOT NULL,
      profession VARCHAR(80) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
