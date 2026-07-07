const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CATEGORIES = [
  "Searching for equipment",
  "Missing linen / pillowcases",
  "Lack of available clinical space",
  "Slow computer systems",
  "Delays locating staff",
  "Waiting for porters",
  "Difficulty obtaining supplies",
  "Administrative hand-offs",
  "Other",
];

const PRIORITIES = ["Low", "Medium", "High"];
const STATUSES = ["Open", "In progress", "Resolved"];

const MAX_DESCRIPTION = 2000;
const MAX_LOCATION = 200;
const MAX_REPORTER = 120;

// Create a new report
app.post("/api/reports", async (req, res) => {
  try {
    const body = req.body || {};
    const category = String(body.category || "").trim();
    const description = String(body.description || "").trim();
    const location = body.location ? String(body.location).trim() : null;
    const reporter = body.reporter ? String(body.reporter).trim() : null;
    let priority = String(body.priority || "Medium").trim();

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

    const result = await pool.query(
      `INSERT INTO reports (category, description, location, priority, reporter)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, category, description, location, priority, reporter, status, created_at`,
      [category, description, location, priority, reporter]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating report:", err);
    res.status(500).json({ error: "Could not save report." });
  }
});

// List reports (most recent first)
app.get("/api/reports", async (req, res) => {
  try {
    const status = req.query.status;
    let query =
      "SELECT id, category, description, location, priority, reporter, status, created_at FROM reports";
    const params = [];
    if (status && STATUSES.includes(status)) {
      params.push(status);
      query += " WHERE status = $1";
    }
    query += " ORDER BY created_at DESC LIMIT 100";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing reports:", err);
    res.status(500).json({ error: "Could not load reports." });
  }
});

// Update a report's status
app.patch("/api/reports/:id", async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const status = String((req.body || {}).status || "").trim();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    const result = await pool.query(
      `UPDATE reports SET status = $1 WHERE id = $2
       RETURNING id, category, description, location, priority, reporter, status, created_at`,
      [status, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    res.json(result.rows[0]);
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
