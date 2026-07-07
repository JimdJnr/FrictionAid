const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
const MAX_REPORTER = 120;
const MAX_RESPONSE = 1000;

// How long a report stays visible in the active lists after being resolved
// before it moves to the "Resolved reports" section.
const RESOLVE_DELAY_MINUTES = 2;

// SQL fragment: true when a report has been resolved long enough to move out
// of the active lists and into the "Resolved reports" section.
const MOVED_TO_RESOLVED =
  "(status = 'Resolved' AND resolved_at IS NOT NULL AND resolved_at <= NOW() - INTERVAL '" +
  RESOLVE_DELAY_MINUTES +
  " minutes')";

const REPORT_COLUMNS =
  "id, category, description, location, priority, reporter, status, feeling, acknowledged_at, acknowledged_by, response_note, created_at, resolved_at";

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

// Create a new report
app.post("/api/reports", async (req, res) => {
  try {
    const body = req.body || {};
    const category = String(body.category || "").trim();
    const description = String(body.description || "").trim();
    const location = body.location ? String(body.location).trim() : null;
    const reporter = body.reporter ? String(body.reporter).trim() : null;
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
    if (reporter && reporter.length > MAX_REPORTER) {
      return res
        .status(400)
        .json({ error: "Name is too long (max " + MAX_REPORTER + " characters)." });
    }
    if (!PRIORITIES.includes(priority)) {
      priority = "Medium";
    }
    // Feeling is optional; ignore anything not on the allowlist.
    if (feeling && !FEELINGS.includes(feeling)) {
      feeling = null;
    }

    const result = await pool.query(
      `INSERT INTO reports (category, description, location, priority, reporter, feeling)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${REPORT_COLUMNS}`,
      [category, description, location, priority, reporter, feeling]
    );
    const report = result.rows[0];
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
app.get("/api/reports", async (req, res) => {
  try {
    const { status, priority, category, sort, bucket } = req.query;
    const conditions = [];
    const params = [];

    if (status && STATUSES.includes(status)) {
      params.push(status);
      conditions.push("status = $" + params.length);
    }
    if (priority && PRIORITIES.includes(priority)) {
      params.push(priority);
      conditions.push("priority = $" + params.length);
    }
    if (category && CATEGORIES.includes(category)) {
      params.push(category);
      conditions.push("category = $" + params.length);
    }

    if (bucket === "resolved") {
      conditions.push(MOVED_TO_RESOLVED);
    } else {
      conditions.push("NOT " + MOVED_TO_RESOLVED);
    }

    let query = "SELECT " + REPORT_COLUMNS + " FROM reports";
    if (conditions.length) {
      query += " WHERE " + conditions.join(" AND ");
    }

    if (bucket === "resolved") {
      // Most recently resolved first.
      query += " ORDER BY resolved_at DESC LIMIT 500";
    } else if (sort === "urgency") {
      // "All reports" view — every active report, highest urgency first.
      query +=
        " ORDER BY CASE priority WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, created_at DESC";
    } else {
      // "Recent reports" view — emergencies pinned to the top, then newest.
      query +=
        " ORDER BY CASE WHEN priority = 'Emergency' THEN 0 ELSE 1 END, created_at DESC LIMIT 100";
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing reports:", err);
    res.status(500).json({ error: "Could not load reports." });
  }
});

// Server-Sent Events stream for real-time emergency notifications.
app.get("/api/events", (req, res) => {
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
app.patch("/api/reports/:id", async (req, res) => {
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

        const ackBy = body.acknowledged_by
          ? String(body.acknowledged_by).trim()
          : null;
        if (ackBy && ackBy.length > MAX_REPORTER) {
          return res
            .status(400)
            .json({ error: "Name is too long (max " + MAX_REPORTER + " characters)." });
        }
        params.push(ackBy || null);
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

    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    params.push(id);
    const result = await pool.query(
      "UPDATE reports SET " + sets.join(", ") + " WHERE id = $" + params.length +
        " RETURNING " + REPORT_COLUMNS,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    const report = result.rows[0];
    if (raisedEmergency) {
      broadcast({ type: "emergency", report: report });
    }
    res.json(report);
  } catch (err) {
    console.error("Error updating report:", err);
    res.status(500).json({ error: "Could not update report." });
  }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200),
      priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
      reporter VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'Open',
      feeling VARCHAR(50),
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by VARCHAR(120),
      response_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migration for existing tables: track when a report was resolved.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
  );
  // Migration for existing tables: reporter feeling + acknowledgement/response.
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS feeling VARCHAR(50)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS acknowledged_by VARCHAR(120)");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS response_note TEXT");
  // Backfill legacy resolved rows so they obey the "move after 2 minutes" rule
  // (without a timestamp they'd stay in the active lists forever).
  await pool.query(
    "UPDATE reports SET resolved_at = created_at WHERE status = 'Resolved' AND resolved_at IS NULL"
  );
}

initSchema()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Ward Report server running at http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
