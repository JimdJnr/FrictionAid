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
// How soon a report should be actioned. "Flexible" is the default when the
// reporter doesn't state a deadline; "ASAP" is reserved for Emergency reports
// (set automatically, never asked for). Kept in sync with public/app.js
// (allowlist-sync invariant). The hours value drives an optional due_at
// deadline; null = no deadline (Flexible).
const TIMEFRAME_HOURS = {
  ASAP: 0,
  "Within 1 hour": 1,
  "Within 2 hours": 2,
  "Within 4 hours": 4,
  "Within 8 hours": 8,
  "Within 24 hours": 24,
  Flexible: null,
};
const TIMEFRAMES = Object.keys(TIMEFRAME_HOURS);
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

// Timeframe windows for the emotional-feedback breakdown on the Insights view.
// Each report tagged with a feeling in the window contributes to a stacked bar.
// The `interval` strings come from this fixed internal list only (never user
// input), so they're safe to inline into the aggregate SQL. Keep the ids in sync
// with FEELING_WINDOW_OPTIONS in public/app.js.
const FEELING_WINDOWS = [
  { id: "hour", interval: "1 hour" },
  { id: "day", interval: "1 day" },
  { id: "d3", interval: "3 days" },
  { id: "week", interval: "7 days" },
  { id: "w2", interval: "14 days" },
  { id: "month", interval: "30 days" },
  { id: "m3", interval: "90 days" },
  { id: "year", interval: "365 days" },
];

// An all-empty feeling-windows payload (one empty array per timeframe), used when
// the viewer isn't in a hospital yet.
function emptyFeelingWindows() {
  const out = {};
  FEELING_WINDOWS.forEach(function (w) { out[w.id] = []; });
  return out;
}

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

// --- Hospital layouts ---------------------------------------------------
// A hospital's physical structure is ONE self-referencing table, not a table
// per level, because hospitals genuinely differ: a small site may hang floors
// straight off the building while a large one uses every level. The rule is
// simply that a child's kind must sit later in this list than its parent's, so
// levels can be skipped but never inverted (a floor can't live inside a room).
// Keep in sync with LOCATION_KINDS in public/app.js.
const LOCATION_KINDS = ["building", "wing", "floor", "department", "corridor", "room"];
const LOCATION_KIND_LABELS = {
  building: "Building / site",
  wing: "Wing / zone",
  floor: "Floor / level",
  department: "Department",
  corridor: "Corridor / shared area",
  room: "Room / facility",
};
// Kinds that occupy space on a floor plan grid (everything else is structural).
const SPATIAL_KINDS = ["corridor", "room"];
// What may stand in for a room when the reporter can't identify one. A whole
// building is too vague to help anyone walking to the job, so it isn't here.
const APPROX_AREA_KINDS = ["department", "floor", "corridor"];
// Floor plans are a fixed-width grid; blocks are placed on whole cells. Height
// is bounded rather than fixed — a floor is only as tall as its content.
const FLOOR_GRID_COLS = 24;
const FLOOR_GRID_ROWS = 40;
const MAX_LOCATION_NAME = 120;
const MAX_LOCATION_CODE = 40;
const MAX_ROOM_TYPE_NAME = 120;

// The default room/area catalogue. Every hospital starts with these and can add
// its own locally-named types on top (see the room_types table, where a NULL
// hospital_id means "shared default"). `symbol` gives the heatmap a non-colour
// encoding so the map is readable without relying on colour alone.
const ROOM_TYPE_SEED = [
  // Inpatient
  { group: "Inpatient", name: "Patient bedroom", symbol: "bed" },
  { group: "Inpatient", name: "Private room", symbol: "bed" },
  { group: "Inpatient", name: "Shared ward", symbol: "ward" },
  { group: "Inpatient", name: "Isolation room", symbol: "isolation" },
  { group: "Inpatient", name: "Negative-pressure room", symbol: "isolation" },
  // Emergency
  { group: "Emergency", name: "Accident & emergency area", symbol: "emergency" },
  { group: "Emergency", name: "Triage room", symbol: "emergency" },
  { group: "Emergency", name: "Resuscitation bay", symbol: "emergency" },
  { group: "Emergency", name: "Treatment bay", symbol: "treatment" },
  { group: "Emergency", name: "Observation unit", symbol: "monitor" },
  // Critical care
  { group: "Critical care", name: "Intensive care unit (ICU)", symbol: "monitor" },
  { group: "Critical care", name: "High-dependency unit (HDU)", symbol: "monitor" },
  { group: "Critical care", name: "Neonatal intensive care (NICU)", symbol: "baby" },
  { group: "Critical care", name: "Cardiac care unit (CCU)", symbol: "monitor" },
  // Theatres
  { group: "Theatres", name: "Operating theatre", symbol: "theatre" },
  { group: "Theatres", name: "Anaesthetic room", symbol: "theatre" },
  { group: "Theatres", name: "Recovery room", symbol: "bed" },
  { group: "Theatres", name: "Scrub area", symbol: "clean" },
  { group: "Theatres", name: "Sterile preparation room", symbol: "clean" },
  // Outpatient
  { group: "Outpatient", name: "Consultation room", symbol: "consult" },
  { group: "Outpatient", name: "Examination room", symbol: "consult" },
  { group: "Outpatient", name: "Treatment room", symbol: "treatment" },
  { group: "Outpatient", name: "Procedure room", symbol: "treatment" },
  { group: "Outpatient", name: "Minor surgery room", symbol: "theatre" },
  // Imaging
  { group: "Imaging", name: "X-ray room", symbol: "imaging" },
  { group: "Imaging", name: "CT scanner", symbol: "imaging" },
  { group: "Imaging", name: "MRI scanner", symbol: "imaging" },
  { group: "Imaging", name: "Ultrasound room", symbol: "imaging" },
  { group: "Imaging", name: "Mammography room", symbol: "imaging" },
  { group: "Imaging", name: "Nuclear medicine room", symbol: "imaging" },
  // Diagnostics & labs
  { group: "Diagnostics & labs", name: "Laboratory", symbol: "lab" },
  { group: "Diagnostics & labs", name: "Pathology room", symbol: "lab" },
  { group: "Diagnostics & labs", name: "Blood bank", symbol: "lab" },
  { group: "Diagnostics & labs", name: "Specimen collection room", symbol: "lab" },
  { group: "Diagnostics & labs", name: "Mortuary", symbol: "mortuary" },
  // Pharmacy
  { group: "Pharmacy", name: "Pharmacy", symbol: "pharmacy" },
  { group: "Pharmacy", name: "Medication room", symbol: "pharmacy" },
  { group: "Pharmacy", name: "Controlled-drug store", symbol: "secure" },
  // Maternity
  { group: "Maternity", name: "Maternity ward", symbol: "baby" },
  { group: "Maternity", name: "Delivery room", symbol: "baby" },
  { group: "Maternity", name: "Birthing suite", symbol: "baby" },
  { group: "Maternity", name: "Postnatal unit", symbol: "baby" },
  // Paediatrics
  { group: "Paediatrics", name: "Paediatric room", symbol: "baby" },
  { group: "Paediatrics", name: "Neonatal room", symbol: "baby" },
  { group: "Paediatrics", name: "Specialist treatment room", symbol: "treatment" },
  // Mental health
  { group: "Mental health", name: "Mental health assessment room", symbol: "consult" },
  { group: "Mental health", name: "Therapy room", symbol: "therapy" },
  { group: "Mental health", name: "Secure patient area", symbol: "secure" },
  // Therapies
  { group: "Therapies", name: "Rehabilitation room", symbol: "therapy" },
  { group: "Therapies", name: "Physiotherapy room", symbol: "therapy" },
  { group: "Therapies", name: "Occupational therapy room", symbol: "therapy" },
  { group: "Therapies", name: "Hydrotherapy pool", symbol: "therapy" },
  // Specialist clinics
  { group: "Specialist clinics", name: "Dental surgery", symbol: "consult" },
  { group: "Specialist clinics", name: "Ophthalmology room", symbol: "consult" },
  { group: "Specialist clinics", name: "Audiology room", symbol: "consult" },
  { group: "Specialist clinics", name: "Specialist clinical room", symbol: "consult" },
  // Staff
  { group: "Staff", name: "Staff office", symbol: "office" },
  { group: "Staff", name: "Meeting room", symbol: "office" },
  { group: "Staff", name: "Training room", symbol: "office" },
  { group: "Staff", name: "Changing room", symbol: "staff" },
  { group: "Staff", name: "Staff break room", symbol: "staff" },
  // Public
  { group: "Public", name: "Reception", symbol: "reception" },
  { group: "Public", name: "Waiting room", symbol: "waiting" },
  { group: "Public", name: "Information desk", symbol: "reception" },
  { group: "Public", name: "Visitor facility", symbol: "waiting" },
  // Catering & logistics
  { group: "Catering & logistics", name: "Kitchen", symbol: "catering" },
  { group: "Catering & logistics", name: "Cafeteria", symbol: "catering" },
  { group: "Catering & logistics", name: "Storage room", symbol: "store" },
  { group: "Catering & logistics", name: "Linen room", symbol: "linen" },
  { group: "Catering & logistics", name: "Laundry room", symbol: "linen" },
  { group: "Catering & logistics", name: "Waste disposal area", symbol: "waste" },
  // Utility
  { group: "Utility", name: "Cleaning cupboard", symbol: "clean" },
  { group: "Utility", name: "Utility room", symbol: "utility" },
  { group: "Utility", name: "Sluice room", symbol: "utility" },
  { group: "Utility", name: "Decontamination room", symbol: "clean" },
  // Facilities
  { group: "Facilities", name: "Plant room", symbol: "plant" },
  { group: "Facilities", name: "Electrical room", symbol: "plant" },
  { group: "Facilities", name: "Server room", symbol: "server" },
  { group: "Facilities", name: "Maintenance workshop", symbol: "plant" },
  { group: "Facilities", name: "Equipment store", symbol: "store" },
  // Circulation & amenities
  { group: "Circulation & amenities", name: "Toilet", symbol: "toilet" },
  { group: "Circulation & amenities", name: "Accessible toilet", symbol: "accessible" },
  { group: "Circulation & amenities", name: "Shower room", symbol: "toilet" },
  { group: "Circulation & amenities", name: "Lift", symbol: "lift" },
  { group: "Circulation & amenities", name: "Stairwell", symbol: "stairs" },
  { group: "Circulation & amenities", name: "Entrance", symbol: "door" },
  { group: "Circulation & amenities", name: "Exit", symbol: "door" },
  { group: "Circulation & amenities", name: "Fire-escape route", symbol: "fire" },
  // Shared & external
  { group: "Shared & external", name: "Corridor", symbol: "corridor" },
  { group: "Shared & external", name: "Lobby", symbol: "reception" },
  { group: "Shared & external", name: "Car park", symbol: "parking" },
  { group: "Shared & external", name: "Loading bay", symbol: "store" },
  { group: "Shared & external", name: "Garden", symbol: "garden" },
  { group: "Shared & external", name: "External area", symbol: "garden" },
];

// Starter layouts, so every hospital has a usable floor plan on first boot
// instead of an empty canvas. IT staff edit these from the Layouts view; the
// seed only ever fills in a hospital that has no layout at all, so local edits
// are never overwritten. Room coordinates are packed automatically (see
// packFloorPlan) rather than hand-written.
//   floors may hang off a building directly OR off a wing — both shapes appear
//   below on purpose, because that is exactly the variation the model exists to
//   support.
const HOSPITAL_LAYOUT_SEED = {
  "St. Mary's General": [
    {
      name: "Main Block",
      code: "MB",
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "Emergency Department",
              code: "ED",
              rooms: [
                ["Triage Room 1", "Triage room"],
                ["Triage Room 2", "Triage room"],
                ["Resus Bay 1", "Resuscitation bay"],
                ["Resus Bay 2", "Resuscitation bay"],
                ["Treatment Bay 1", "Treatment bay"],
                ["Treatment Bay 2", "Treatment bay"],
              ],
            },
            {
              name: "Main Entrance",
              code: "ENT",
              rooms: [
                ["Main Reception", "Reception", 6],
                ["Waiting Room", "Waiting room", 6],
                ["Visitor Café", "Cafeteria", 4],
                ["Accessible Toilet G1", "Accessible toilet", 4],
                ["Main Lift Lobby", "Lift", 4],
              ],
            },
          ],
        },
        {
          name: "First Floor",
          code: "1",
          departments: [
            {
              name: "Theatres",
              code: "THR",
              rooms: [
                ["Theatre 1", "Operating theatre", 5],
                ["Theatre 2", "Operating theatre", 5],
                ["Anaesthetic Room", "Anaesthetic room"],
                ["Recovery Room", "Recovery room", 6],
                ["Scrub Area", "Scrub area", 4],
                ["Sterile Prep", "Sterile preparation room", 4],
              ],
            },
            {
              name: "Surgical Wards",
              code: "SUR",
              rooms: [
                ["Ward 7", "Shared ward", 6],
                ["Ward 8", "Shared ward", 6],
                ["Side Room 1", "Isolation room", 4],
                ["Side Room 2", "Isolation room", 4],
                ["Sluice Room 1F", "Sluice room", 4],
                ["Linen Store 1F", "Linen room", 4],
                ["Staff Break Room 1F", "Staff break room", 4],
                ["Ward 7 Store", "Equipment store", 4],
              ],
            },
          ],
        },
        {
          name: "Second Floor",
          code: "2",
          departments: [
            {
              name: "Critical Care",
              code: "ITU",
              rooms: [
                ["ICU Bay 1", "Intensive care unit (ICU)", 5],
                ["ICU Bay 2", "Intensive care unit (ICU)", 5],
                ["HDU Bay 1", "High-dependency unit (HDU)", 5],
                ["Isolation Suite", "Negative-pressure room", 5],
                ["ICU Store", "Equipment store", 4],
                ["Relatives Room", "Waiting room", 4],
              ],
            },
            {
              name: "Cardiology",
              code: "CAR",
              rooms: [
                ["Cardiac Care Unit", "Cardiac care unit (CCU)", 6],
                ["Echo Room", "Ultrasound room"],
                ["Clinic Room 1", "Consultation room"],
                ["Clinic Room 2", "Consultation room"],
                ["Cardiology Office", "Staff office", 4],
              ],
            },
          ],
        },
      ],
    },
    {
      name: "Diagnostics Centre",
      code: "DC",
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "Radiology",
              code: "RAD",
              rooms: [
                ["X-ray Room 1", "X-ray room"],
                ["CT Scanner", "CT scanner", 5],
                ["MRI Suite", "MRI scanner", 5],
                ["Ultrasound 1", "Ultrasound room"],
                ["Radiology Reception", "Reception", 6],
              ],
            },
            {
              name: "Pathology",
              code: "PATH",
              rooms: [
                ["Main Laboratory", "Laboratory", 7],
                ["Blood Bank", "Blood bank", 5],
                ["Specimen Reception", "Specimen collection room", 6],
                ["Mortuary", "Mortuary", 6],
              ],
            },
          ],
        },
        {
          name: "Lower Ground",
          code: "LG",
          departments: [
            {
              name: "Estates & Plant",
              code: "EST",
              rooms: [
                ["Main Plant Room", "Plant room", 6],
                ["Server Room DC", "Server room", 5],
                ["Electrical Intake", "Electrical room", 5],
                ["Maintenance Workshop", "Maintenance workshop", 8],
                ["Waste Compound", "Waste disposal area", 6],
                ["Loading Bay", "Loading bay", 6],
              ],
            },
          ],
        },
      ],
    },
  ],

  "Royal London Hospital": [
    {
      name: "Tower Block",
      code: "TB",
      // This building uses wings; St Mary's does not. Both are valid.
      wings: [
        {
          name: "East Wing",
          code: "E",
          floors: [
            {
              name: "Third Floor",
              code: "3",
              departments: [
                {
                  name: "Maternity",
                  code: "MAT",
                  rooms: [
                    ["Delivery Room 1", "Delivery room", 5],
                    ["Delivery Room 2", "Delivery room", 5],
                    ["Birthing Suite", "Birthing suite", 6],
                    ["Postnatal Ward", "Postnatal unit", 8],
                    ["Maternity Triage", "Triage room", 5],
                    ["Milk Kitchen", "Kitchen", 4],
                  ],
                },
                {
                  name: "Neonatal Unit",
                  code: "NNU",
                  rooms: [
                    ["NICU Bay 1", "Neonatal intensive care (NICU)", 6],
                    ["NICU Bay 2", "Neonatal intensive care (NICU)", 6],
                    ["Parents Room", "Waiting room", 5],
                    ["NNU Store", "Storage room", 4],
                  ],
                },
              ],
            },
            {
              name: "Fourth Floor",
              code: "4",
              departments: [
                {
                  name: "Paediatrics",
                  code: "PAED",
                  rooms: [
                    ["Rainbow Ward", "Shared ward", 8],
                    ["Paediatric Side Room 1", "Isolation room", 5],
                    ["Play Room", "Visitor facility", 5],
                    ["Paediatric Clinic 1", "Paediatric room"],
                    ["Paediatric Clinic 2", "Paediatric room"],
                    ["Treatment Room P1", "Specialist treatment room", 4],
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "West Wing",
          code: "W",
          floors: [
            {
              name: "Third Floor",
              code: "3",
              departments: [
                {
                  name: "Mental Health",
                  code: "MH",
                  rooms: [
                    ["Assessment Room 1", "Mental health assessment room", 6],
                    ["Assessment Room 2", "Mental health assessment room", 6],
                    ["Therapy Room 1", "Therapy room", 6],
                    ["Quiet Lounge", "Secure patient area", 6],
                    ["MH Staff Office", "Staff office", 5],
                  ],
                },
                {
                  name: "Therapies",
                  code: "THP",
                  rooms: [
                    ["Physiotherapy Gym", "Physiotherapy room", 8],
                    ["Occupational Therapy", "Occupational therapy room", 6],
                    ["Hydrotherapy Pool", "Hydrotherapy pool", 6],
                    ["Rehab Store", "Equipment store", 4],
                  ],
                },
              ],
            },
          ],
        },
      ],
      // A floor hanging directly off the building, skipping the wing level.
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "Main Concourse",
              code: "CON",
              rooms: [
                ["Tower Reception", "Reception", 6],
                ["Information Desk", "Information desk", 5],
                ["Concourse Café", "Cafeteria", 5],
                ["Outpatient Pharmacy", "Pharmacy", 5],
                ["Public Toilets G", "Toilet", 4],
                ["Accessible Toilet G", "Accessible toilet", 4],
                ["North Stairwell", "Stairwell", 4],
                ["Tower Lifts", "Lift", 4],
              ],
            },
          ],
        },
      ],
    },
    {
      name: "Outpatients Centre",
      code: "OPC",
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "General Outpatients",
              code: "OPD",
              rooms: [
                ["Consulting Room 1", "Consultation room"],
                ["Consulting Room 2", "Consultation room"],
                ["Consulting Room 3", "Consultation room"],
                ["Examination Room 1", "Examination room"],
                ["Procedure Room", "Procedure room"],
                ["OPD Waiting", "Waiting room", 4],
              ],
            },
            {
              name: "Specialist Clinics",
              code: "SPC",
              rooms: [
                ["Dental Surgery 1", "Dental surgery", 6],
                ["Ophthalmology Room", "Ophthalmology room", 6],
                ["Audiology Booth", "Audiology room", 6],
                ["Minor Ops Room", "Minor surgery room", 6],
              ],
            },
          ],
        },
      ],
    },
  ],

  "Manchester Central": [
    {
      name: "Central Building",
      code: "CB",
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "Urgent Care",
              code: "UC",
              rooms: [
                ["UC Triage", "Triage room", 5],
                ["UC Treatment Bay 1", "Treatment bay", 5],
                ["UC Treatment Bay 2", "Treatment bay", 5],
                ["Observation Unit", "Observation unit", 5],
                ["UC Reception", "Reception", 6],
                ["UC Waiting", "Waiting room", 6],
              ],
            },
            {
              name: "Support Services",
              code: "SUP",
              rooms: [
                ["Main Kitchen", "Kitchen", 6],
                ["Central Linen Store", "Linen room", 5],
                ["Laundry", "Laundry room", 5],
                ["Cleaners Cupboard G", "Cleaning cupboard", 4],
                ["Central Stores", "Storage room", 6],
                ["IT Server Room", "Server room", 6],
              ],
            },
          ],
        },
        {
          name: "First Floor",
          code: "1",
          departments: [
            {
              name: "Medical Wards",
              code: "MED",
              rooms: [
                ["Ward 1", "Shared ward", 8],
                ["Ward 2", "Shared ward", 8],
                ["Ward 1 Side Room", "Isolation room", 4],
                ["Ward 2 Side Room", "Isolation room", 4],
                ["Medicines Room 1F", "Medication room", 5],
                ["Sluice 1F", "Sluice room", 4],
                ["Ward Office", "Staff office", 4],
                ["Ward Store", "Equipment store", 4],
              ],
            },
          ],
        },
      ],
    },
  ],

  "Testing Ground": [
    {
      name: "Sandbox Building",
      code: "SB",
      floors: [
        {
          name: "Ground Floor",
          code: "G",
          departments: [
            {
              name: "Sandbox Ward",
              code: "SBW",
              rooms: [
                ["Test Room A", "Patient bedroom", 6],
                ["Test Room B", "Patient bedroom", 6],
                ["Test Treatment Room", "Treatment room", 6],
                ["Test Store", "Storage room", 6],
                ["Test Office", "Staff office", 6],
                ["Test Reception", "Reception", 6],
              ],
            },
          ],
        },
      ],
    },
  ],
};

// Lay a floor's departments out on the grid: each department gets a horizontal
// band of rooms (wrapping when a row fills), with a full-width corridor between
// bands. Returns placements plus the corridors to create, so the seed data can
// stay as plain room lists instead of hand-written coordinates.
function packFloorPlan(departments) {
  const ROOM_H = 3;
  const CORRIDOR_H = 2;
  const DEFAULT_W = 4;
  const rooms = [];
  const corridors = [];
  let y = 0;
  departments.forEach(function (dept, di) {
    let x = 0;
    dept.rooms.forEach(function (room, ri) {
      const w = Math.min(room[2] || DEFAULT_W, FLOOR_GRID_COLS);
      if (x + w > FLOOR_GRID_COLS) {
        x = 0;
        y += ROOM_H;
      }
      rooms.push({ dept: di, room: ri, x: x, y: y, w: w, h: ROOM_H });
      x += w;
    });
    y += ROOM_H;
    // A corridor between each pair of departments (not after the last one).
    if (di < departments.length - 1) {
      corridors.push({ index: di, x: 0, y: y, w: FLOOR_GRID_COLS, h: CORRIDOR_H });
      y += CORRIDOR_H;
    }
  });
  return { rooms: rooms, corridors: corridors, rowsUsed: y };
}

// Insert one layout node and return its id.
async function insertSeedLocation(row) {
  const r = await pool.query(
    `INSERT INTO locations (hospital_id, parent_id, kind, name, code, room_type_id, grid_x, grid_y, grid_w, grid_h, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      row.hospitalId,
      row.parentId || null,
      row.kind,
      row.name,
      row.code,
      row.roomTypeId || null,
      row.x == null ? null : row.x,
      row.y == null ? null : row.y,
      row.w == null ? null : row.w,
      row.h == null ? null : row.h,
      row.sortOrder || 0,
    ]
  );
  return r.rows[0].id;
}

// Build one floor: its departments, their rooms packed onto the grid, and the
// corridors between them.
async function seedFloor(hospitalId, floorId, floorCode, floor, typeIdByName) {
  const departments = floor.departments || [];
  const packed = packFloorPlan(departments);
  const deptIds = [];
  for (let di = 0; di < departments.length; di++) {
    const dept = departments[di];
    deptIds.push(
      await insertSeedLocation({
        hospitalId: hospitalId,
        parentId: floorId,
        kind: "department",
        name: dept.name,
        code: floorCode + "-" + dept.code,
        sortOrder: di,
      })
    );
  }
  let roomSeq = 0;
  for (const p of packed.rooms) {
    const dept = departments[p.dept];
    const spec = dept.rooms[p.room];
    roomSeq += 1;
    await insertSeedLocation({
      hospitalId: hospitalId,
      parentId: deptIds[p.dept],
      kind: "room",
      name: spec[0],
      code: floorCode + "-R" + String(roomSeq).padStart(2, "0"),
      roomTypeId: typeIdByName[spec[1]] || null,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      sortOrder: p.room,
    });
  }
  // Corridors belong to the floor itself, not to a department — they are the
  // shared space between them.
  for (let ci = 0; ci < packed.corridors.length; ci++) {
    const c = packed.corridors[ci];
    await insertSeedLocation({
      hospitalId: hospitalId,
      parentId: floorId,
      kind: "corridor",
      name: floor.name + " Corridor " + (ci + 1),
      code: floorCode + "-C" + (ci + 1),
      roomTypeId: typeIdByName["Corridor"] || null,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      sortOrder: 100 + ci,
    });
  }
}

// Give a hospital a starter layout. Only ever runs when the hospital has no
// layout at all, so an IT team's own edits are never overwritten on restart.
async function seedHospitalLayouts() {
  const types = await pool.query(
    "SELECT id, name FROM room_types WHERE hospital_id IS NULL"
  );
  const typeIdByName = {};
  types.rows.forEach(function (t) { typeIdByName[t.name] = t.id; });

  const hospitals = await pool.query("SELECT id, name FROM hospitals");
  for (const h of hospitals.rows) {
    const buildings = HOSPITAL_LAYOUT_SEED[h.name];
    if (!buildings) continue;
    const existing = await pool.query(
      "SELECT 1 FROM locations WHERE hospital_id = $1 LIMIT 1",
      [h.id]
    );
    if (existing.rowCount > 0) continue;

    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      const buildingId = await insertSeedLocation({
        hospitalId: h.id,
        parentId: null,
        kind: "building",
        name: b.name,
        code: b.code,
        sortOrder: bi,
      });
      // Floors hanging straight off the building (wing level skipped).
      const directFloors = b.floors || [];
      for (let fi = 0; fi < directFloors.length; fi++) {
        const f = directFloors[fi];
        const floorCode = b.code + "-" + f.code;
        const floorId = await insertSeedLocation({
          hospitalId: h.id,
          parentId: buildingId,
          kind: "floor",
          name: f.name,
          code: floorCode,
          sortOrder: fi,
        });
        await seedFloor(h.id, floorId, floorCode, f, typeIdByName);
      }
      // Floors inside wings.
      const wings = b.wings || [];
      for (let wi = 0; wi < wings.length; wi++) {
        const w = wings[wi];
        const wingCode = b.code + "-" + w.code;
        const wingId = await insertSeedLocation({
          hospitalId: h.id,
          parentId: buildingId,
          kind: "wing",
          name: w.name,
          code: wingCode,
          sortOrder: wi,
        });
        const wFloors = w.floors || [];
        for (let fi = 0; fi < wFloors.length; fi++) {
          const f = wFloors[fi];
          const floorCode = wingCode + "-" + f.code;
          const floorId = await insertSeedLocation({
            hospitalId: h.id,
            parentId: wingId,
            kind: "floor",
            name: f.name,
            code: floorCode,
            sortOrder: fi,
          });
          await seedFloor(h.id, floorId, floorCode, f, typeIdByName);
        }
      }
    }
    console.log("Seeded starter layout for " + h.name);
  }
}

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
// Optional photo attached to a report. Stored on the row as a data URL, exactly
// like profile pictures, so no extra storage service is needed. The client
// downscales before uploading; this is the hard ceiling if it doesn't.
const MAX_PHOTO = 1500000; // ~1 MB data URL
const PHOTO_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
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
  "SELECT r.id, r.category, r.description, r.location, r.priority, r.department, r.reporter, r.identity_mode, r.status, r.feeling, r.acknowledged_at, r.acknowledged_by, r.response_note, r.outcome, r.created_at, r.resolved_at, r.user_id, r.hospital_id, r.assigned_to, r.assigned_at, r.timeframe, r.due_at, r.feedback_resolved_ok, r.feedback_comment, r.feedback_at, r.location_id, r.location_approx, ll.name AS location_name, ll.code AS location_code, lp.path AS location_path, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name, u.profession AS reporter_profession, u.avatar AS reporter_avatar, au.first_name AS assignee_first_name, au.last_name AS assignee_last_name, au.profession AS assignee_profession, au.avatar AS assignee_avatar, (r.photo IS NOT NULL) AS has_photo, (SELECT COUNT(*)::int FROM report_updates up WHERE up.report_id = r.id) AS update_count FROM reports r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users au ON au.id = r.assigned_to LEFT JOIN locations ll ON ll.id = r.location_id LEFT JOIN LATERAL (WITH RECURSIVE chain AS (SELECT c.id, c.parent_id, c.name, 0 AS depth FROM locations c WHERE c.id = r.location_id UNION ALL SELECT p.id, p.parent_id, p.name, chain.depth + 1 FROM locations p JOIN chain ON p.id = chain.parent_id WHERE chain.depth < 12) SELECT string_agg(chain.name, ' \u203a ' ORDER BY chain.depth DESC) AS path FROM chain) lp ON TRUE";

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

// Continuous re-allocation. Any report that landed in Open Reports (nobody was
// free when it was created, or its owner was released) keeps trying to find an
// owner. This runs on a timer and is also kicked whenever a colleague becomes
// free, so an Open report is handed over the moment capacity appears. Scoped per
// hospital; broadcasts a refresh so open browsers update their lists live.
// Pass a hospId to sweep just that department, or omit to sweep everywhere.
let sweeping = false;
async function sweepUnallocatedReports(hospId) {
  if (sweeping) return; // avoid overlapping runs (timer + event triggers)
  sweeping = true;
  try {
    const params = [];
    let where =
      "assigned_to IS NULL AND status <> 'Resolved' AND hospital_id IS NOT NULL";
    if (hospId) {
      params.push(hospId);
      where += " AND hospital_id = $1";
    }
    // Most urgent first, then the soonest deadline, then longest-waiting.
    const open = await pool.query(
      `SELECT id, hospital_id, user_id, category FROM reports
       WHERE ${where}
       ORDER BY CASE priority
           WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1
           WHEN 'Medium' THEN 2 ELSE 3 END,
         due_at ASC NULLS LAST, created_at ASC`,
      params
    );
    const touched = new Set();
    for (const r of open.rows) {
      const assignee = await pickAssignee(r.hospital_id, r.user_id, r.category);
      if (!assignee) continue; // still nobody free — leave it Open
      const upd = await pool.query(
        "UPDATE reports SET assigned_to = $1, assigned_at = NOW() WHERE id = $2 AND assigned_to IS NULL",
        [assignee, r.id]
      );
      if (upd.rowCount) touched.add(r.hospital_id);
    }
    touched.forEach((h) => broadcast({ type: "reports-changed" }, h));
  } catch (err) {
    console.error("Error sweeping unallocated reports:", err);
  } finally {
    sweeping = false;
  }
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
    const affectedHospIds = new Set([id]);
    sseClients.forEach(function (c) {
      if (c.userId === req.user.id) {
        if (c.hospitalId != null) affectedHospIds.add(c.hospitalId);
        c.hospitalId = id;
      }
    });
    // Refresh rosters in both the department we left and the one we joined so
    // the user disappears from the old roster and appears (online) in the new.
    affectedHospIds.forEach(function (h) {
      broadcast({ type: "presence" }, h);
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
    `SELECT cm.conversation_id, cm.user_id, cm.role,
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
  const myRoleByConv = {};
  members.rows.forEach(function (m) {
    (membersByConv[m.conversation_id] || (membersByConv[m.conversation_id] = [])).push({
      id: m.user_id,
      first_name: m.first_name,
      last_name: m.last_name,
      profession: m.profession,
      avatar: m.avatar,
      role: m.role || "member",
    });
    if (m.user_id === viewerId) myRoleByConv[m.conversation_id] = m.role || "member";
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
      my_role: myRoleByConv[c.id] || "member",
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
    // Optional first message: lets the client create a DM and send its opening
    // message in one atomic call, so a "draft" DM never leaves an empty row
    // behind if the send fails (see the Staff-view draft-DM flow).
    const firstBody = String(body.body || "").trim().slice(0, 4000);

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
        const existId = existing.rows[0].id;
        // The DM already exists — just append the opening message if one was sent.
        if (firstBody) {
          const message = await insertMessage(pool, existId, req.user, firstBody);
          broadcastToUsers({ type: "message", conversation_id: existId, message: message }, allMembers);
        }
        const list = await conversationSummaries([existId], req.user.id);
        return res.json(list[0]);
      }
    }

    // Create the conversation, its members and (optionally) the first message in
    // a single transaction so a failure leaves no orphaned empty conversation.
    const client = await pool.connect();
    let convId;
    let firstMessage = null;
    try {
      await client.query("BEGIN");
      const conv = await client.query(
        `INSERT INTO conversations (hospital_id, is_group, title, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [hospId, isGroup, title, req.user.id]
      );
      convId = conv.rows[0].id;
      for (const uid of allMembers) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, last_read_at, role)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [convId, uid, uid === req.user.id ? new Date() : null,
            uid === req.user.id ? "owner" : "member"]
        );
      }
      if (firstBody) {
        firstMessage = await insertMessage(client, convId, req.user, firstBody);
      }
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
    const list = await conversationSummaries([convId], req.user.id);
    // Notify the other members so a new conversation appears live.
    broadcastToUsers({ type: "conversation", conversation_id: convId }, validIds);
    if (firstMessage) {
      broadcastToUsers({ type: "message", conversation_id: convId, message: firstMessage }, allMembers);
    }
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

// Insert a message + mark the sender read, returning the message object. `q` is
// either the pool or a transaction client (so callers can compose it into a
// larger atomic operation, e.g. create-conversation-with-first-message).
async function insertMessage(q, convId, user, bodyText) {
  const inserted = await q.query(
    `INSERT INTO messages (conversation_id, user_id, body)
     VALUES ($1, $2, $3) RETURNING id, created_at`,
    [convId, user.id, bodyText]
  );
  await q.query(
    "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2",
    [convId, user.id]
  );
  return {
    id: inserted.rows[0].id,
    conversation_id: convId,
    body: bodyText,
    created_at: inserted.rows[0].created_at,
    user_id: user.id,
    author: fullName(user),
    avatar: user.avatar,
  };
}

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
    const message = await insertMessage(pool, id, req.user, bodyText);
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

// "Ring" a conversation (member-only): notify every other member to jump into
// the chat. This is a lightweight, ephemeral nudge (no live audio/video and no
// stored message) delivered live over SSE — like a phone ring you either catch
// or miss.
app.post("/api/conversations/:id/ring", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    const memberRows = await pool.query(
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2",
      [id, req.user.id]
    );
    const others = memberRows.rows.map(function (r) {
      return r.user_id;
    });
    broadcastToUsers(
      {
        type: "ring",
        conversation_id: id,
        is_group: !!conv.is_group,
        title: conv.title || null,
        caller: fullName(req.user),
        caller_id: req.user.id,
      },
      others
    );
    res.json({ ok: true, notified: others.length });
  } catch (err) {
    console.error("Error ringing conversation:", err);
    res.status(500).json({ error: "Could not ring the conversation." });
  }
});

// --------------------- Live calls (WebRTC signaling) ---------------------
// The server is only a *signaling relay* for calls: browsers exchange WebRTC
// offers/answers/ICE candidates through these endpoints (delivered over the
// shared SSE stream), then stream audio/video peer-to-peer. It never touches the
// media itself. Group calls use a full mesh (every participant peers with every
// other), which is fine for small huddles.
//
// `callRooms` maps a conversationId -> Set of userIds currently in that call. It
// is in-memory, so — like presence and emergency SSE — it only works on a single
// instance (Reserved VM, not Autoscale; see that invariant).
const callRooms = new Map();

// Remove a user from a conversation's call and tell the remaining participants.
function leaveCall(convId, userId) {
  const room = callRooms.get(convId);
  if (!room || !room.has(userId)) return false;
  room.delete(userId);
  const others = Array.from(room);
  if (room.size === 0) callRooms.delete(convId);
  broadcastToUsers({ type: "call-leave", conversation_id: convId, user_id: userId }, others);
  return true;
}

// Join the live call for a conversation. Returns the participants already in the
// call so the newcomer knows who to expect; the existing participants are told to
// offer a peer connection to the newcomer (so each pair negotiates exactly once).
app.post("/api/conversations/:id/call/join", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    // Compute the current roster and add ourselves in one synchronous block (no
    // await between) so concurrent joins can't miss each other.
    let room = callRooms.get(id);
    if (!room) { room = new Set(); callRooms.set(id, room); }
    const others = Array.from(room).filter(function (u) { return u !== req.user.id; });
    room.add(req.user.id);
    // Tell everyone already in the call that we joined (they'll offer to us).
    broadcastToUsers(
      { type: "call-join", conversation_id: id, user_id: req.user.id, name: fullName(req.user), avatar: req.user.avatar || null },
      others
    );
    // Also ring anyone not yet in the call so they get an incoming-call banner.
    const memberRows = await pool.query(
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2",
      [id, req.user.id]
    );
    const notInCall = memberRows.rows
      .map(function (r) { return r.user_id; })
      .filter(function (u) { return others.indexOf(u) === -1; });
    if (notInCall.length) {
      broadcastToUsers(
        { type: "ring", conversation_id: id, is_group: !!conv.is_group, title: conv.title || null, caller: fullName(req.user), caller_id: req.user.id, is_call: true },
        notInCall
      );
    }
    // Names/avatars for the newcomer's call UI.
    let participants = [];
    if (others.length) {
      const info = await pool.query(
        "SELECT id, first_name, last_name, avatar FROM users WHERE id = ANY($1)",
        [others]
      );
      participants = info.rows.map(function (r) {
        return { user_id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" "), avatar: r.avatar || null };
      });
    }
    res.json({ participants: participants, is_group: !!conv.is_group });
  } catch (err) {
    console.error("Error joining call:", err);
    res.status(500).json({ error: "Could not join the call." });
  }
});

// Leave the live call for a conversation.
app.post("/api/conversations/:id/call/leave", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    leaveCall(id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error leaving call:", err);
    res.status(500).json({ error: "Could not leave the call." });
  }
});

// Relay a WebRTC signaling message (offer / answer / ICE candidate) to one other
// member of the conversation. The server never inspects `signal` — it just forwards.
app.post("/api/conversations/:id/call/signal", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    const body = req.body || {};
    const to = parseInt(body.to, 10);
    if (!Number.isInteger(to)) return res.status(400).json({ error: "Invalid target." });
    // The target must belong to this conversation.
    const m = await pool.query(
      "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
      [id, to]
    );
    if (!m.rows[0]) return res.status(404).json({ error: "Target isn't in this conversation." });
    broadcastToUsers(
      { type: "call-signal", conversation_id: id, from: req.user.id, from_name: fullName(req.user), signal: body.signal },
      [to]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error relaying call signal:", err);
    res.status(500).json({ error: "Could not relay the signal." });
  }
});

// The caller's role within a conversation ('owner' | 'admin' | 'member'), or
// null if they aren't a member. Used to gate group-management actions.
async function convMemberRole(convId, userId) {
  const r = await pool.query(
    "SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    [convId, userId]
  );
  return r.rows[0] ? r.rows[0].role || "member" : null;
}

// Notify every current member of a conversation that its membership/roles
// changed, plus anyone explicitly named (e.g. a just-removed user), so their
// conversation lists and any open thread refresh live.
async function broadcastConvChanged(convId, extraUserIds) {
  const rows = await pool.query(
    "SELECT user_id FROM conversation_members WHERE conversation_id = $1",
    [convId]
  );
  const ids = rows.rows.map(function (r) { return r.user_id; });
  (extraUserIds || []).forEach(function (id) {
    if (ids.indexOf(id) === -1) ids.push(id);
  });
  broadcastToUsers({ type: "conversation", conversation_id: convId }, ids);
}

// Add people to a group conversation. Owner or admin only. New members must
// belong to (or be online in) the active department, mirroring create.
app.post("/api/conversations/:id/members", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    if (!conv.is_group) return res.status(400).json({ error: "Not a group conversation." });
    const myRole = await convMemberRole(id, req.user.id);
    if (myRole !== "owner" && myRole !== "admin") {
      return res.status(403).json({ error: "Only the group owner or admins can add people." });
    }
    const body = req.body || {};
    let memberIds = (Array.isArray(body.member_ids) ? body.member_ids : [])
      .map(function (n) { return parseInt(n, 10); })
      .filter(function (n) { return Number.isInteger(n); });
    memberIds = Array.from(new Set(memberIds));
    if (!memberIds.length) return res.status(400).json({ error: "Pick at least one person." });
    // Only add people in this department (home or currently online here).
    const onlineIds = onlineUserIdsInHospital(hospId);
    const valid = await pool.query(
      "SELECT id FROM users WHERE id = ANY($1) AND (hospital_id = $2 OR id = ANY($3))",
      [memberIds, hospId, Array.from(onlineIds)]
    );
    const validIds = valid.rows.map(function (r) { return r.id; });
    if (validIds.length !== memberIds.length) {
      return res.status(400).json({ error: "Some people aren't in this department." });
    }
    for (const uid of validIds) {
      await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [id, uid]
      );
    }
    await broadcastConvChanged(id);
    const list = await conversationSummaries([id], req.user.id);
    res.json(list[0]);
  } catch (err) {
    console.error("Error adding members:", err);
    res.status(500).json({ error: "Could not add people." });
  }
});

// Remove (kick) a member from a group conversation. Owner only; the owner
// cannot be removed.
app.delete("/api/conversations/:id/members/:uid", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.uid)) {
      return res.status(400).json({ error: "Invalid id." });
    }
    const id = parseInt(req.params.id, 10);
    const uid = parseInt(req.params.uid, 10);
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    if (!conv.is_group) return res.status(400).json({ error: "Not a group conversation." });
    const myRole = await convMemberRole(id, req.user.id);
    if (myRole !== "owner") {
      return res.status(403).json({ error: "Only the group owner can remove people." });
    }
    const targetRole = await convMemberRole(id, uid);
    if (!targetRole) return res.status(404).json({ error: "That person isn't in this group." });
    if (targetRole === "owner") {
      return res.status(400).json({ error: "The owner can't be removed." });
    }
    await pool.query(
      "DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
      [id, uid]
    );
    await broadcastConvChanged(id, [uid]);
    const list = await conversationSummaries([id], req.user.id);
    res.json(list[0]);
  } catch (err) {
    console.error("Error removing member:", err);
    res.status(500).json({ error: "Could not remove that person." });
  }
});

// Change a member's role in a group conversation. Owner only; the owner's own
// role can't be changed. Roles: 'admin' (can add people) or 'member'.
app.patch("/api/conversations/:id/members/:uid", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.uid)) {
      return res.status(400).json({ error: "Invalid id." });
    }
    const id = parseInt(req.params.id, 10);
    const uid = parseInt(req.params.uid, 10);
    const role = String((req.body || {}).role || "").trim();
    if (role !== "admin" && role !== "member") {
      return res.status(400).json({ error: "Role must be admin or member." });
    }
    const hospId = activeHospitalId(req);
    const conv = await memberConversation(id, req.user.id, hospId);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    if (!conv.is_group) return res.status(400).json({ error: "Not a group conversation." });
    const myRole = await convMemberRole(id, req.user.id);
    if (myRole !== "owner") {
      return res.status(403).json({ error: "Only the group owner can change permissions." });
    }
    if (uid === req.user.id) {
      return res.status(400).json({ error: "You can't change your own role." });
    }
    const targetRole = await convMemberRole(id, uid);
    if (!targetRole) return res.status(404).json({ error: "That person isn't in this group." });
    if (targetRole === "owner") {
      return res.status(400).json({ error: "The owner's role can't be changed." });
    }
    await pool.query(
      "UPDATE conversation_members SET role = $1 WHERE conversation_id = $2 AND user_id = $3",
      [role, id, uid]
    );
    await broadcastConvChanged(id);
    const list = await conversationSummaries([id], req.user.id);
    res.json(list[0]);
  } catch (err) {
    console.error("Error changing member role:", err);
    res.status(500).json({ error: "Could not change permissions." });
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

// --------------------------- Hospital layouts ----------------------------
// Buildings, wings, floors, departments, corridors and rooms, plus the room
// type catalogue. Reads are open to anyone in the hospital (reporters need the
// room picker); writes need IT level or above. Everything is scoped through the
// existing activeHospitalId()/accessRank() pair rather than a parallel
// permission system, so switching department switches the layout you manage.

const LOCATION_COLS =
  "l.id, l.hospital_id, l.parent_id, l.kind, l.name, l.code, l.room_type_id, " +
  "l.grid_x, l.grid_y, l.grid_w, l.grid_h, l.sort_order, l.active, " +
  "rt.name AS room_type_name, rt.type_group AS room_type_group, rt.symbol AS room_type_symbol";
const LOCATION_FROM = " FROM locations l LEFT JOIN room_types rt ON rt.id = l.room_type_id";

function canEditLayout(req) {
  return accessRank(req.user) >= 1;
}

// Which hospital's layout is being read/written. Defaults to the caller's
// active department; only an admin may name a different one.
function resolveLayoutHospital(req, requested) {
  const active = activeHospitalId(req);
  if (requested == null || requested === "" || Number(requested) === active) {
    return { id: active };
  }
  if (!/^\d+$/.test(String(requested))) return { error: "Invalid hospital id." };
  if (!req.user.is_admin) {
    return { error: "You can only manage your own department's layout." };
  }
  return { id: parseInt(String(requested), 10) };
}

async function fetchLocation(id) {
  const r = await pool.query(
    "SELECT " + LOCATION_COLS + LOCATION_FROM + " WHERE l.id = $1",
    [id]
  );
  return r.rows[0] || null;
}

// Every node at or below `id` (used for cycle checks, cascading deletes and
// "does this subtree still have tickets?").
async function descendantIds(id) {
  const r = await pool.query(
    `WITH RECURSIVE down AS (
       SELECT id FROM locations WHERE id = $1
       UNION ALL
       SELECT l.id FROM locations l JOIN down d ON l.parent_id = d.id
     ) SELECT id FROM down`,
    [id]
  );
  return r.rows.map(function (row) { return row.id; });
}

// The floor a node sits on, by walking up its ancestors. Spatial kinds must
// resolve to one — that is the grid their coordinates belong to.
async function floorIdOf(id) {
  if (id == null) return null;
  const r = await pool.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, kind FROM locations WHERE id = $1
       UNION ALL
       SELECT l.id, l.parent_id, l.kind FROM locations l JOIN up ON up.parent_id = l.id
     ) SELECT id FROM up WHERE kind = 'floor' LIMIT 1`,
    [id]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

// Every spatial block on a floor (rooms + corridors), whatever depth they hang
// at — some sit under a department, corridors usually sit on the floor itself.
async function blocksOnFloor(floorId) {
  const r = await pool.query(
    `WITH RECURSIVE down AS (
       SELECT id FROM locations WHERE id = $1
       UNION ALL
       SELECT l.id FROM locations l JOIN down d ON l.parent_id = d.id
     )
     SELECT ` + LOCATION_COLS + LOCATION_FROM +
      ` WHERE l.id IN (SELECT id FROM down) AND l.kind = ANY($2)`,
    [floorId, SPATIAL_KINDS]
  );
  return r.rows;
}

// Kind ordering: a child must be a later kind than its parent. Levels may be
// skipped (not every hospital has wings) but never inverted.
async function validateParentage(hospitalId, kind, parentId) {
  const kindIdx = LOCATION_KINDS.indexOf(kind);
  if (kindIdx < 0) return { error: "Unknown location type." };
  if (kind === "building") {
    if (parentId != null) return { error: "A building sits at the top — it can't have a parent." };
    return { parent: null };
  }
  if (parentId == null) {
    return { error: LOCATION_KIND_LABELS[kind] + " needs to sit inside something." };
  }
  const parent = await fetchLocation(parentId);
  if (!parent || parent.hospital_id !== hospitalId) {
    return { error: "That parent location doesn't exist in this hospital." };
  }
  if (LOCATION_KINDS.indexOf(parent.kind) >= kindIdx) {
    return {
      error:
        "A " + LOCATION_KIND_LABELS[kind].toLowerCase() +
        " can't sit inside a " + LOCATION_KIND_LABELS[parent.kind].toLowerCase() + ".",
    };
  }
  return { parent: parent };
}

// Codes are the human reference ("MB-G-R01"). Generated from the name when the
// caller doesn't supply one, and always made unique within the hospital.
async function uniqueLocationCode(hospitalId, base, ignoreId) {
  let root = String(base || "LOC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LOCATION_CODE - 4) || "LOC";
  let candidate = root;
  for (let n = 2; n < 500; n++) {
    const r = await pool.query(
      "SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 AND ($3::int IS NULL OR id <> $3)",
      [hospitalId, candidate, ignoreId == null ? null : ignoreId]
    );
    if (r.rowCount === 0) return candidate;
    candidate = root + "-" + n;
  }
  return root + "-" + Date.now();
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

// First free slot big enough for a new block, scanning top-left to bottom-right.
function findFreeSlot(existing, w, h) {
  const taken = existing
    .filter(function (b) { return b.grid_x != null; })
    .map(function (b) {
      return { x: b.grid_x, y: b.grid_y, w: b.grid_w || 1, h: b.grid_h || 1 };
    });
  for (let y = 0; y + h <= FLOOR_GRID_ROWS; y++) {
    for (let x = 0; x + w <= FLOOR_GRID_COLS; x++) {
      const candidate = { x: x, y: y, w: w, h: h };
      if (!taken.some(function (t) { return rectsOverlap(candidate, t); })) {
        return candidate;
      }
    }
  }
  return null;
}

// Shortcuts for the report wizard's room picker: the places this reporter has
// used lately, and the places their hospital reports most. Both are returned
// as bare ids — the client already holds the layout, so resolving them there
// means the picker, the issue map and the heatmap can never disagree about
// what a place is called or where it sits.
app.get("/api/locations/shortcuts", requireAuth, async (req, res) => {
  try {
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json({ recent: [], frequent: [] });
    const kinds = SPATIAL_KINDS.concat(APPROX_AREA_KINDS).filter(function (k, i, a) {
      return a.indexOf(k) === i;
    });
    // Recency is personal: this user's own last few pins, newest first.
    const recent = await pool.query(
      `SELECT r.location_id, MAX(r.created_at) AS last_used
         FROM reports r JOIN locations l ON l.id = r.location_id
        WHERE r.user_id = $1 AND r.hospital_id = $2
          AND l.hospital_id = $2 AND l.active AND l.kind = ANY($3)
        GROUP BY r.location_id
        ORDER BY last_used DESC
        LIMIT 5`,
      [req.user.id, hospId, kinds]
    );
    // Frequency is the hospital's, so a new starter still gets useful defaults.
    const frequent = await pool.query(
      `SELECT r.location_id, COUNT(*)::int AS n
         FROM reports r JOIN locations l ON l.id = r.location_id
        WHERE r.hospital_id = $1
          AND l.hospital_id = $1 AND l.active AND l.kind = ANY($2)
        GROUP BY r.location_id
        ORDER BY n DESC, r.location_id ASC
        LIMIT 6`,
      [hospId, kinds]
    );
    res.json({
      recent: recent.rows.map(function (row) { return row.location_id; }),
      frequent: frequent.rows.map(function (row) { return row.location_id; }),
    });
  } catch (err) {
    console.error("Error loading location shortcuts:", err);
    res.status(500).json({ error: "Could not load location shortcuts." });
  }
});

// The full layout tree for one hospital, plus the room types it can use.
app.get("/api/layout", requireAuth, async (req, res) => {
  try {
    const target = resolveLayoutHospital(req, req.query.hospital_id);
    if (target.error) return res.status(403).json({ error: target.error });
    if (!target.id) {
      return res.json({
        hospital_id: null,
        hospital_name: null,
        can_edit: false,
        grid: { cols: FLOOR_GRID_COLS, rows: FLOOR_GRID_ROWS },
        locations: [],
        room_types: [],
      });
    }
    const hosp = await pool.query("SELECT id, name FROM hospitals WHERE id = $1", [target.id]);
    if (!hosp.rows[0]) return res.status(404).json({ error: "Hospital not found." });

    const locations = await pool.query(
      "SELECT " + LOCATION_COLS +
        ", (SELECT COUNT(*)::int FROM reports r WHERE r.location_id = l.id) AS report_count" +
        LOCATION_FROM +
        " WHERE l.hospital_id = $1 ORDER BY l.sort_order ASC, l.name ASC",
      [target.id]
    );
    const roomTypes = await pool.query(
      "SELECT id, hospital_id, name, type_group, symbol FROM room_types" +
        " WHERE hospital_id IS NULL OR hospital_id = $1" +
        " ORDER BY type_group ASC, name ASC",
      [target.id]
    );
    res.json({
      hospital_id: hosp.rows[0].id,
      hospital_name: hosp.rows[0].name,
      // Admins may edit any hospital; everyone else only their active one.
      can_edit:
        canEditLayout(req) &&
        (req.user.is_admin || target.id === activeHospitalId(req)),
      grid: { cols: FLOOR_GRID_COLS, rows: FLOOR_GRID_ROWS },
      locations: locations.rows,
      room_types: roomTypes.rows,
    });
  } catch (err) {
    console.error("Error loading layout:", err);
    res.status(500).json({ error: "Could not load the layout." });
  }
});

// Add a locally-named room type the shared catalogue doesn't cover.
app.post("/api/room-types", requireAuth, async (req, res) => {
  try {
    if (!canEditLayout(req)) {
      return res.status(403).json({ error: "You don't have permission to edit the layout." });
    }
    const target = resolveLayoutHospital(req, (req.body || {}).hospital_id);
    if (target.error) return res.status(403).json({ error: target.error });
    if (!target.id) return res.status(400).json({ error: "You're not in a department." });

    const body = req.body || {};
    const name = String(body.name || "").trim();
    const group = String(body.type_group || "Custom").trim() || "Custom";
    const symbol = String(body.symbol || "room").trim() || "room";
    if (!name || name.length > MAX_ROOM_TYPE_NAME) {
      return res.status(400).json({ error: "Please give the room type a name." });
    }
    const clash = await pool.query(
      "SELECT id FROM room_types WHERE name = $1 AND (hospital_id IS NULL OR hospital_id = $2)",
      [name, target.id]
    );
    if (clash.rowCount > 0) {
      return res.status(409).json({ error: "That room type already exists." });
    }
    const r = await pool.query(
      `INSERT INTO room_types (hospital_id, name, type_group, symbol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, hospital_id, name, type_group, symbol`,
      [target.id, name, group.slice(0, 80), symbol.slice(0, 40)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "That room type already exists." });
    }
    console.error("Error adding room type:", err);
    res.status(500).json({ error: "Could not add the room type." });
  }
});

// Create a location anywhere in the tree.
app.post("/api/locations", requireAuth, async (req, res) => {
  try {
    if (!canEditLayout(req)) {
      return res.status(403).json({ error: "You don't have permission to edit the layout." });
    }
    const body = req.body || {};
    const target = resolveLayoutHospital(req, body.hospital_id);
    if (target.error) return res.status(403).json({ error: target.error });
    if (!target.id) return res.status(400).json({ error: "You're not in a department." });

    const kind = String(body.kind || "").trim();
    const name = String(body.name || "").trim();
    if (!name || name.length > MAX_LOCATION_NAME) {
      return res.status(400).json({ error: "Please give the location a name." });
    }
    const parentId =
      body.parent_id == null || body.parent_id === "" ? null : Number(body.parent_id);
    if (parentId != null && !Number.isInteger(parentId)) {
      return res.status(400).json({ error: "Invalid parent location." });
    }
    const parentage = await validateParentage(target.id, kind, parentId);
    if (parentage.error) return res.status(400).json({ error: parentage.error });

    // Room type only applies to things that occupy space.
    let roomTypeId = null;
    if (body.room_type_id != null && body.room_type_id !== "") {
      const rt = await pool.query(
        "SELECT id FROM room_types WHERE id = $1 AND (hospital_id IS NULL OR hospital_id = $2)",
        [Number(body.room_type_id), target.id]
      );
      if (rt.rowCount === 0) return res.status(400).json({ error: "Unknown room type." });
      roomTypeId = rt.rows[0].id;
    }

    let grid = null;
    if (SPATIAL_KINDS.includes(kind)) {
      const floorId = await floorIdOf(parentId);
      if (!floorId) {
        return res.status(400).json({
          error: "A " + LOCATION_KIND_LABELS[kind].toLowerCase() + " has to sit on a floor.",
        });
      }
      const existing = await blocksOnFloor(floorId);
      const w = clampInt(body.grid_w, 1, FLOOR_GRID_COLS, kind === "corridor" ? 12 : 4);
      const h = clampInt(body.grid_h, 1, FLOOR_GRID_ROWS, kind === "corridor" ? 2 : 3);
      if (body.grid_x != null && body.grid_y != null) {
        grid = {
          x: clampInt(body.grid_x, 0, FLOOR_GRID_COLS - w, 0),
          y: clampInt(body.grid_y, 0, FLOOR_GRID_ROWS - h, 0),
          w: w,
          h: h,
        };
        const clash = existing.some(function (b) {
          return (
            b.grid_x != null &&
            rectsOverlap(grid, { x: b.grid_x, y: b.grid_y, w: b.grid_w, h: b.grid_h })
          );
        });
        if (clash) return res.status(409).json({ error: "That spot is already taken." });
      } else {
        grid = findFreeSlot(existing, w, h);
        if (!grid) return res.status(409).json({ error: "This floor plan is full." });
      }
    }

    const code = await uniqueLocationCode(
      target.id,
      body.code ? String(body.code) : (parentage.parent ? parentage.parent.code + "-" : "") + name
    );
    const order = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM locations WHERE hospital_id = $1 AND parent_id IS NOT DISTINCT FROM $2",
      [target.id, parentId]
    );
    const inserted = await pool.query(
      `INSERT INTO locations (hospital_id, parent_id, kind, name, code, room_type_id, grid_x, grid_y, grid_w, grid_h, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        target.id, parentId, kind, name, code, roomTypeId,
        grid ? grid.x : null, grid ? grid.y : null, grid ? grid.w : null, grid ? grid.h : null,
        order.rows[0].next,
      ]
    );
    broadcast({ type: "layout-changed" }, target.id);
    res.status(201).json(await fetchLocation(inserted.rows[0].id));
  } catch (err) {
    console.error("Error creating location:", err);
    res.status(500).json({ error: "Could not create the location." });
  }
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// Rename, re-parent, retype, move/resize, reorder or deactivate a location.
app.patch("/api/locations/:id", requireAuth, async (req, res) => {
  try {
    if (!canEditLayout(req)) {
      return res.status(403).json({ error: "You don't have permission to edit the layout." });
    }
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid location id." });
    }
    const id = parseInt(req.params.id, 10);
    const current = await fetchLocation(id);
    if (!current) return res.status(404).json({ error: "Location not found." });
    const target = resolveLayoutHospital(req, current.hospital_id);
    if (target.error || target.id !== current.hospital_id) {
      return res.status(403).json({ error: "You can only edit your own department's layout." });
    }

    const body = req.body || {};
    const sets = [];
    const params = [];
    const add = function (col, val) {
      params.push(val);
      sets.push(col + " = $" + params.length);
    };

    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name || name.length > MAX_LOCATION_NAME) {
        return res.status(400).json({ error: "Please give the location a name." });
      }
      add("name", name);
    }
    if (body.code !== undefined) {
      add("code", await uniqueLocationCode(current.hospital_id, String(body.code || ""), id));
    }
    if (body.room_type_id !== undefined) {
      if (body.room_type_id == null || body.room_type_id === "") {
        add("room_type_id", null);
      } else {
        const rt = await pool.query(
          "SELECT id FROM room_types WHERE id = $1 AND (hospital_id IS NULL OR hospital_id = $2)",
          [Number(body.room_type_id), current.hospital_id]
        );
        if (rt.rowCount === 0) return res.status(400).json({ error: "Unknown room type." });
        add("room_type_id", rt.rows[0].id);
      }
    }
    if (body.active !== undefined) {
      add("active", !!body.active);
    }
    if (body.sort_order !== undefined) {
      add("sort_order", clampInt(body.sort_order, 0, 100000, current.sort_order));
    }

    // Re-parenting. Must keep kind ordering AND must not create a cycle by
    // moving a node inside its own subtree.
    let newParentId = current.parent_id;
    // Rooms/corridors that must be re-placed on a new floor as part of a
    // cross-floor move (see below). Applied atomically with the main update.
    const roomRelocations = [];
    if (body.parent_id !== undefined) {
      newParentId =
        body.parent_id == null || body.parent_id === "" ? null : Number(body.parent_id);
      if (newParentId != null && !Number.isInteger(newParentId)) {
        return res.status(400).json({ error: "Invalid parent location." });
      }
      if (newParentId === id) {
        return res.status(400).json({ error: "A location can't sit inside itself." });
      }
      const parentage = await validateParentage(current.hospital_id, current.kind, newParentId);
      if (parentage.error) return res.status(400).json({ error: parentage.error });
      if (newParentId != null) {
        const subtree = await descendantIds(id);
        if (subtree.includes(newParentId)) {
          return res.status(400).json({ error: "A location can't sit inside one of its own children." });
        }
      }

      // Moving a structural node (e.g. a department) to a different floor drags
      // every room inside it along. Their coordinates belong to the OLD floor's
      // grid, so instead of refusing the move we relocate the rooms as a group:
      // each one is re-placed into free space on the destination floor via
      // findFreeSlot. All placements are computed up front and applied in one
      // transaction below, so either the whole department moves or nothing
      // does. A floor keeps its own rooms wherever its building sits, so
      // re-parenting a floor is fine.
      if (!SPATIAL_KINDS.includes(current.kind) && current.kind !== "floor") {
        const oldFloor = await floorIdOf(current.parent_id);
        const newFloor = await floorIdOf(newParentId);
        if (oldFloor !== newFloor) {
          const subtree = await descendantIds(id);
          const inner = subtree.filter(function (x) { return x !== id; });
          if (inner.length) {
            const spatial = await pool.query(
              "SELECT " + LOCATION_COLS + LOCATION_FROM +
                " WHERE l.id = ANY($1) AND l.kind = ANY($2)" +
                " ORDER BY l.grid_y ASC NULLS LAST, l.grid_x ASC NULLS LAST, l.id ASC",
              [inner, SPATIAL_KINDS]
            );
            if (spatial.rowCount > 0) {
              if (!newFloor) {
                return res.status(400).json({
                  error:
                    current.name + " has rooms laid out on a floor plan, so it " +
                    "can only move somewhere that sits on a floor.",
                });
              }
              // Blocks already on the destination floor (the moved rooms can't
              // be among them — they're on a different floor by definition).
              const occupied = (await blocksOnFloor(newFloor))
                .filter(function (b) { return b.grid_x != null; })
                .map(function (b) {
                  return { grid_x: b.grid_x, grid_y: b.grid_y, grid_w: b.grid_w, grid_h: b.grid_h };
                });
              for (const room of spatial.rows) {
                const w = Math.min(room.grid_w || 4, FLOOR_GRID_COLS);
                const h = Math.min(room.grid_h || 3, FLOOR_GRID_ROWS);
                const slot = findFreeSlot(occupied, w, h);
                if (!slot) {
                  return res.status(409).json({
                    error:
                      "The destination floor doesn't have enough free space " +
                      "for all of " + current.name + "'s rooms (" + room.name +
                      " wouldn't fit). Nothing has been moved — clear some " +
                      "space on that floor and try again.",
                  });
                }
                occupied.push({ grid_x: slot.x, grid_y: slot.y, grid_w: w, grid_h: h });
                roomRelocations.push({ id: room.id, x: slot.x, y: slot.y, w: w, h: h });
              }
            }
          }
        }
      }
      add("parent_id", newParentId);
    }

    // Moving or resizing a block on the floor plan.
    const movingGrid =
      body.grid_x !== undefined || body.grid_y !== undefined ||
      body.grid_w !== undefined || body.grid_h !== undefined;
    if (movingGrid || body.parent_id !== undefined) {
      if (SPATIAL_KINDS.includes(current.kind)) {
        const floorId = await floorIdOf(newParentId);
        if (!floorId) {
          return res.status(400).json({
            error: "A " + LOCATION_KIND_LABELS[current.kind].toLowerCase() + " has to sit on a floor.",
          });
        }
        const w = clampInt(body.grid_w, 1, FLOOR_GRID_COLS, current.grid_w || 4);
        const h = clampInt(body.grid_h, 1, FLOOR_GRID_ROWS, current.grid_h || 3);
        const rect = {
          x: clampInt(body.grid_x, 0, FLOOR_GRID_COLS - w, Math.min(current.grid_x || 0, FLOOR_GRID_COLS - w)),
          y: clampInt(body.grid_y, 0, FLOOR_GRID_ROWS - h, Math.min(current.grid_y || 0, FLOOR_GRID_ROWS - h)),
          w: w,
          h: h,
        };
        const existing = await blocksOnFloor(floorId);
        const clash = existing.some(function (b) {
          if (b.id === id || b.grid_x == null) return false;
          return rectsOverlap(rect, { x: b.grid_x, y: b.grid_y, w: b.grid_w, h: b.grid_h });
        });
        if (clash) return res.status(409).json({ error: "That spot is already taken." });
        add("grid_x", rect.x);
        add("grid_y", rect.y);
        add("grid_w", rect.w);
        add("grid_h", rect.h);
      } else if (movingGrid) {
        return res.status(400).json({
          error: LOCATION_KIND_LABELS[current.kind] + " isn't placed on a floor plan.",
        });
      }
    }

    if (!sets.length) return res.json(current);
    params.push(id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE locations SET " + sets.join(", ") + " WHERE id = $" + params.length,
        params
      );
      for (const move of roomRelocations) {
        await client.query(
          "UPDATE locations SET grid_x = $1, grid_y = $2, grid_w = $3, grid_h = $4 WHERE id = $5",
          [move.x, move.y, move.w, move.h, move.id]
        );
      }
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
    broadcast({ type: "layout-changed" }, current.hospital_id);
    res.json(await fetchLocation(id));
  } catch (err) {
    console.error("Error updating location:", err);
    res.status(500).json({ error: "Could not update the location." });
  }
});

// Remove a location. Refused while any ticket still points at it (or anything
// inside it) — history would silently lose where it happened. The caller is
// told it can deactivate instead, which hides the place from new reports while
// leaving old tickets intact.
app.delete("/api/locations/:id", requireAuth, async (req, res) => {
  try {
    if (!canEditLayout(req)) {
      return res.status(403).json({ error: "You don't have permission to edit the layout." });
    }
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid location id." });
    }
    const id = parseInt(req.params.id, 10);
    const current = await fetchLocation(id);
    if (!current) return res.status(404).json({ error: "Location not found." });
    const target = resolveLayoutHospital(req, current.hospital_id);
    if (target.error || target.id !== current.hospital_id) {
      return res.status(403).json({ error: "You can only edit your own department's layout." });
    }

    const subtree = await descendantIds(id);
    const attached = await pool.query(
      "SELECT COUNT(*)::int AS n FROM reports WHERE location_id = ANY($1)",
      [subtree]
    );
    const n = attached.rows[0].n;
    if (n > 0) {
      return res.status(409).json({
        error:
          n === 1
            ? "1 report still points here, so this can't be deleted."
            : n + " reports still point here, so this can't be deleted.",
        report_count: n,
        can_deactivate: true,
      });
    }
    await pool.query("DELETE FROM locations WHERE id = $1", [id]);
    broadcast({ type: "layout-changed" }, current.hospital_id);
    res.json({ ok: true, removed: subtree.length });
  } catch (err) {
    console.error("Error deleting location:", err);
    res.status(500).json({ error: "Could not delete the location." });
  }
});

// Validate a room/corridor a report is being pinned to. Always optional: a
// reporter who can't find their room must still be able to submit, so a blank
// value is a valid answer, not an error. Deactivated places are refused for new
// pins (they stay readable on historic tickets).
async function resolveReportLocation(hospId, raw, approx) {
  if (raw == null || raw === "") {
    // "I can't identify the room" is only an honest answer if it still says
    // roughly where — an approximate pin with nothing attached is just blank.
    if (approx) return { error: "Choose the nearest department or shared area." };
    return { id: null };
  }
  if (!/^\d+$/.test(String(raw))) return { error: "Invalid location." };
  const loc = await fetchLocation(parseInt(String(raw), 10));
  // A confirmed pin has to be somewhere you can stand and point at. An
  // approximate one may be a whole ward, floor or corridor instead.
  const allowed = approx ? APPROX_AREA_KINDS : SPATIAL_KINDS;
  if (!loc || loc.hospital_id !== hospId || !allowed.includes(loc.kind)) {
    return { error: "That place isn't on this hospital's floor plans." };
  }
  if (!loc.active) return { error: "That place is no longer in use." };
  return { id: loc.id, location: loc };
}

// ------------------------------- Heatmap ---------------------------------
// Per-room ticket aggregates for one floor. Deliberately returns summaries
// only — counts, the worst open priority, overdue totals, averages — never the
// tickets themselves, so the map can be drawn without shipping detail the
// viewer might not be entitled to open. Drill-through is a separate, scoped
// request (GET /api/locations/:id/reports).

// Rank priorities in SQL so "worst open issue in this room" is one aggregate.
// Built from the fixed PRIORITIES list, never user input, so inlining is safe.
const PRIORITY_RANK_SQL =
  "CASE r.priority " +
  PRIORITIES.map(function (p, i) {
    return "WHEN '" + p + "' THEN " + (i + 1);
  }).join(" ") +
  " ELSE 0 END";

// A location's nearest department ancestor, resolved client-side style from the
// flat list (cheaper than a query per block).
function departmentOf(node, byId) {
  let cur = node;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.kind === "department") return cur;
    cur = cur.parent_id == null ? null : byId[cur.parent_id];
  }
  return null;
}

app.get("/api/heatmap", requireAuth, async (req, res) => {
  try {
    const target = resolveLayoutHospital(req, req.query.hospital_id);
    if (target.error) return res.status(403).json({ error: target.error });
    const hospId = target.id;
    const empty = {
      floor: null,
      blocks: [],
      totals: { rooms: 0, total: 0, open: 0, overdue: 0, hotspots: 0 },
      max_total: 0,
    };
    if (!hospId) return res.json(empty);
    if (!/^\d+$/.test(String(req.query.floor_id || ""))) {
      return res.status(400).json({ error: "A floor is required." });
    }
    const floorId = parseInt(String(req.query.floor_id), 10);
    const floor = await fetchLocation(floorId);
    if (!floor || floor.hospital_id !== hospId || floor.kind !== "floor") {
      return res.status(404).json({ error: "Floor not found." });
    }

    // --- Ticket-level filters (applied inside the aggregate's join) ---
    const params = [floorId, SPATIAL_KINDS, hospId];
    const where = [];
    const list = function (raw, allowed) {
      const values = String(raw || "")
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s && allowed.includes(s); });
      return values.length ? values : null;
    };
    const priorities = list(req.query.priority, PRIORITIES);
    if (priorities) {
      params.push(priorities);
      where.push("r.priority = ANY($" + params.length + ")");
    }
    const categories = list(req.query.category, CATEGORIES);
    if (categories) {
      params.push(categories);
      where.push("r.category = ANY($" + params.length + ")");
    }
    const statuses = list(req.query.status, STATUSES);
    if (statuses) {
      params.push(statuses);
      where.push("r.status = ANY($" + params.length + ")");
    }
    if (/^\d+$/.test(String(req.query.assigned_to || ""))) {
      params.push(parseInt(String(req.query.assigned_to), 10));
      where.push("r.assigned_to = $" + params.length);
    }
    if (req.query.from && !isNaN(Date.parse(String(req.query.from)))) {
      params.push(new Date(String(req.query.from)));
      where.push("r.created_at >= $" + params.length);
    }
    if (req.query.to && !isNaN(Date.parse(String(req.query.to)))) {
      params.push(new Date(String(req.query.to)));
      where.push("r.created_at <= $" + params.length);
    }
    const resolution = String(req.query.resolution || "any");
    if (resolution === "resolved") where.push("r.status = 'Resolved'");
    if (resolution === "unresolved") where.push("r.status <> 'Resolved'");
    if (resolution === "overdue") {
      where.push("r.status <> 'Resolved' AND r.due_at IS NOT NULL AND r.due_at < NOW()");
    }
    const joinFilter = where.length ? " AND " + where.join(" AND ") : "";

    const subtreeCte =
      `WITH RECURSIVE down AS (
         SELECT id, parent_id, kind FROM locations WHERE id = $1
         UNION ALL
         SELECT l.id, l.parent_id, l.kind FROM locations l JOIN down d ON l.parent_id = d.id
       ), blocks AS (SELECT id FROM down WHERE kind = ANY($2))`;

    const agg = await pool.query(
      subtreeCte +
        ` SELECT b.id,
            COUNT(r.id)::int AS total,
            COUNT(r.id) FILTER (WHERE r.status = 'Open')::int AS open_count,
            COUNT(r.id) FILTER (WHERE r.status = 'In progress')::int AS in_progress,
            COUNT(r.id) FILTER (WHERE r.status = 'Resolved')::int AS resolved,
            COUNT(r.id) FILTER (WHERE r.status <> 'Resolved' AND r.due_at IS NOT NULL AND r.due_at < NOW())::int AS overdue,
            MAX(CASE WHEN r.status <> 'Resolved' THEN ` + PRIORITY_RANK_SQL + ` END) AS top_open_rank,
            MAX(` + PRIORITY_RANK_SQL + `) AS top_rank,
            MODE() WITHIN GROUP (ORDER BY r.category) AS top_category,
            AVG(EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 60.0)
              FILTER (WHERE r.status = 'Resolved' AND r.resolved_at IS NOT NULL) AS avg_resolve_minutes,
            MAX(r.created_at) AS last_report_at
          FROM blocks b
          LEFT JOIN reports r
            ON r.location_id = b.id AND r.hospital_id = $3` + joinFilter +
        ` GROUP BY b.id`,
      params
    );

    // A room counts as "recurring" when the same category has come back more
    // than once there — the signal that something is not actually fixed.
    const recur = await pool.query(
      subtreeCte +
        ` SELECT location_id, COUNT(*)::int AS repeat_categories FROM (
            SELECT r.location_id, r.category
            FROM reports r
            WHERE r.location_id IN (SELECT id FROM blocks) AND r.hospital_id = $3` + joinFilter +
        `   GROUP BY r.location_id, r.category
            HAVING COUNT(*) > 1
          ) t GROUP BY location_id`,
      params
    );
    const recurringById = {};
    recur.rows.forEach(function (row) { recurringById[row.location_id] = row.repeat_categories; });

    // Structural context: every location in the hospital, so each block can
    // report the department it belongs to.
    const all = await pool.query(
      "SELECT " + LOCATION_COLS + LOCATION_FROM + " WHERE l.hospital_id = $1",
      [hospId]
    );
    const byId = {};
    all.rows.forEach(function (n) { byId[n.id] = n; });
    const aggById = {};
    agg.rows.forEach(function (row) { aggById[row.id] = row; });

    // --- Room-level filters (only meaningful once the tickets are counted) ---
    const deptFilter = /^\d+$/.test(String(req.query.department_id || ""))
      ? parseInt(String(req.query.department_id), 10)
      : null;
    const typeFilter = /^\d+$/.test(String(req.query.room_type_id || ""))
      ? parseInt(String(req.query.room_type_id), 10)
      : null;
    const minVolume = /^\d+$/.test(String(req.query.min_volume || ""))
      ? parseInt(String(req.query.min_volume), 10)
      : 0;
    const maxAvg = /^\d+$/.test(String(req.query.max_avg_minutes || ""))
      ? parseInt(String(req.query.max_avg_minutes), 10)
      : null;

    const blocks = [];
    let maxTotal = 0;
    let totalTickets = 0;
    let totalOpen = 0;
    let totalOverdue = 0;
    Object.keys(aggById).forEach(function (key) {
      const node = byId[Number(key)];
      if (!node) return;
      const a = aggById[key];
      const dept = departmentOf(node, byId);
      if (deptFilter != null && (!dept || dept.id !== deptFilter)) return;
      if (typeFilter != null && node.room_type_id !== typeFilter) return;
      const recurring = recurringById[node.id] || 0;
      if (resolution === "recurring" && recurring === 0) return;
      if (a.total < minVolume) return;
      const avg = a.avg_resolve_minutes == null ? null : Math.round(Number(a.avg_resolve_minutes));
      if (maxAvg != null && (avg == null || avg > maxAvg)) return;

      maxTotal = Math.max(maxTotal, a.total);
      totalTickets += a.total;
      totalOpen += a.open_count + a.in_progress;
      totalOverdue += a.overdue;
      blocks.push({
        id: node.id,
        name: node.name,
        code: node.code,
        kind: node.kind,
        active: node.active,
        grid_x: node.grid_x,
        grid_y: node.grid_y,
        grid_w: node.grid_w,
        grid_h: node.grid_h,
        room_type_id: node.room_type_id,
        room_type_name: node.room_type_name,
        room_type_group: node.room_type_group,
        room_type_symbol: node.room_type_symbol,
        department_id: dept ? dept.id : null,
        department_name: dept ? dept.name : null,
        total: a.total,
        open: a.open_count,
        in_progress: a.in_progress,
        resolved: a.resolved,
        overdue: a.overdue,
        recurring: recurring,
        top_priority: a.top_open_rank ? PRIORITIES[a.top_open_rank - 1] : null,
        worst_priority: a.top_rank ? PRIORITIES[a.top_rank - 1] : null,
        top_category: a.top_category,
        avg_resolve_minutes: avg,
        last_report_at: a.last_report_at,
      });
    });

    res.json({
      hospital_id: hospId,
      floor: { id: floor.id, name: floor.name, code: floor.code },
      grid: { cols: FLOOR_GRID_COLS, rows: FLOOR_GRID_ROWS },
      blocks: blocks,
      totals: {
        rooms: blocks.length,
        total: totalTickets,
        open: totalOpen,
        overdue: totalOverdue,
        hotspots: blocks.filter(function (b) { return b.total > 0; }).length,
      },
      max_total: maxTotal,
    });
  } catch (err) {
    console.error("Error building heatmap:", err);
    res.status(500).json({ error: "Could not build the heatmap." });
  }
});

// Drill-through: the tickets behind one room on the map. Scoped to the
// viewer's hospital exactly like /api/reports, so the map can never be used as
// a side channel into another department's tickets.
app.get("/api/locations/:id/reports", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid location id." });
    }
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json([]);
    const id = parseInt(req.params.id, 10);
    const loc = await fetchLocation(id);
    if (!loc || loc.hospital_id !== hospId) {
      return res.status(404).json({ error: "Location not found." });
    }
    const r = await pool.query(
      REPORT_SELECT +
        " WHERE r.location_id = $1 AND r.hospital_id = $2 ORDER BY r.created_at DESC LIMIT 50",
      [id, hospId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error("Error loading location reports:", err);
    res.status(500).json({ error: "Could not load reports for that room." });
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

    // Optional photo of the problem. Never trust the client's downscaling —
    // re-check the type and the size here, and reject rather than truncate so
    // a half-written image can't be stored.
    let photo = null;
    if (body.photo) {
      photo = String(body.photo);
      if (!PHOTO_DATA_URL.test(photo)) {
        return res.status(400).json({ error: "The attachment must be a PNG, JPEG or WebP image." });
      }
      if (photo.length > MAX_PHOTO) {
        return res.status(400).json({ error: "That photo is too large (max ~1 MB). Try taking it again." });
      }
    }

    // Completion timeframe. Optional and defaults to "Flexible" when the
    // reporter doesn't state one. Emergencies are always "ASAP" (never asked).
    let timeframe = body.timeframe ? String(body.timeframe).trim() : "Flexible";
    if (!TIMEFRAMES.includes(timeframe)) timeframe = "Flexible";
    if (priority === "Emergency") timeframe = "ASAP";
    const dueHours = TIMEFRAME_HOURS[timeframe];

    // Tie the report to the hospital the reporter is currently working in, so
    // reports stay specialised to their department.
    const hospitalId = activeHospitalId(req);
    // Pin to a precise room on the hospital's floor plan, or — when the
    // reporter says they can't identify the room — to the nearest department
    // or shared area, recorded as approximate so nobody reads it as confirmed.
    const approxLocation = body.location_approx === true || body.location_approx === "true";
    const pinned = await resolveReportLocation(hospitalId, body.location_id, approxLocation);
    if (pinned.error) return res.status(400).json({ error: pinned.error });
    // Never carry the flag on a row with nothing to qualify.
    const locationApprox = approxLocation && pinned.id != null;
    // Auto-allocate to a colleague who is free right now; null → Open Reports.
    const assignee = await pickAssignee(hospitalId, req.user.id, category);
    const inserted = await pool.query(
      `INSERT INTO reports (category, description, location, priority, feeling, department, user_id, hospital_id, assigned_to, assigned_at, timeframe, due_at, location_id, photo, location_approx)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() END, $10,
         CASE WHEN $11::int IS NULL THEN NULL ELSE NOW() + ($11::int || ' hours')::interval END, $12, $13, $14)
       RETURNING id`,
      [category, description, location, priority, feeling, department, req.user.id, hospitalId, assignee, timeframe, dueHours, pinned.id, photo, locationApprox]
    );
    const report = await fetchReportById(inserted.rows[0].id);
    if (report.priority === "Emergency") {
      broadcast({ type: "emergency", report: report }, report.hospital_id);
    }
    // A new ticket changes the map, so tell the hospital.
    broadcast({ type: "reports-changed" }, report.hospital_id);
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

// --------------------- Closing-the-loop feedback --------------------------
// After a report is resolved we ask the person who raised it whether it was
// actually sorted and whether the process felt good. The prompt is deliberately
// late and one-shot:
//   • the report must be Resolved,
//   • at least FEEDBACK_DELAY_MINUTES must have passed since it was submitted,
//   • feedback must not already have been requested for it.
// A report that is still unresolved after the delay simply waits — it becomes
// eligible the moment it is resolved. The "user isn't mid-submission" condition
// is a client-side concern (only the browser knows), so the client only asks
// for a due report when the reporter isn't filling in another one.
const FEEDBACK_DELAY_MINUTES = 5;
const MAX_FEEDBACK_COMMENT = 1000;
// What a reporter can ask for when their issue wasn't actually resolved.
const FEEDBACK_NEXT_STEPS = ["reopen", "support", "related", "none"];

// The single oldest report that is currently due for a feedback prompt, or null.
// Read-only: asking does not consume the one-shot (see .../feedback/requested).
app.get("/api/reports/feedback-due", requireAuth, async (req, res) => {
  try {
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json({ report: null });
    const due = await pool.query(
      `SELECT id, category, description, location, priority, department, status,
              outcome, created_at, resolved_at
         FROM reports
        WHERE user_id = $1
          AND hospital_id = $2
          AND status = 'Resolved'
          AND created_at <= NOW() - make_interval(mins => $3)
          AND feedback_requested_at IS NULL
        ORDER BY resolved_at ASC NULLS LAST, id ASC
        LIMIT 1`,
      [req.user.id, hospId, FEEDBACK_DELAY_MINUTES]
    );
    res.json({ report: due.rows[0] || null });
  } catch (err) {
    console.error("Error checking feedback-due reports:", err);
    res.status(500).json({ error: "Could not check for feedback." });
  }
});

// Claim the one-shot prompt for a report. The client calls this at the moment it
// actually shows the prompt; the UPDATE only succeeds while feedback_requested_at
// is still NULL, so two tabs racing can never both show it. `claimed:false` means
// someone (or another tab) already asked — don't show it again.
app.post("/api/reports/:id/feedback/requested", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const hospId = activeHospitalId(req);
    if (!hospId) return res.json({ claimed: false });
    // Re-state every eligibility gate here, not just the latch: this is the
    // endpoint that burns the one-shot, so a hand-rolled request must not be
    // able to consume the ask for a report that isn't actually due yet.
    const claimed = await pool.query(
      `UPDATE reports SET feedback_requested_at = NOW()
        WHERE id = $1 AND user_id = $2 AND hospital_id = $3
          AND status = 'Resolved'
          AND created_at <= NOW() - make_interval(mins => $4)
          AND feedback_requested_at IS NULL
        RETURNING id`,
      [parseInt(req.params.id, 10), req.user.id, hospId, FEEDBACK_DELAY_MINUTES]
    );
    res.json({ claimed: claimed.rowCount > 0 });
  } catch (err) {
    console.error("Error claiming feedback prompt:", err);
    res.status(500).json({ error: "Could not open the feedback prompt." });
  }
});

// Record the reporter's answer. Only the person who raised the report may answer,
// and only once — a second submission is rejected so the loop really is one-shot.
app.post("/api/reports/:id/feedback", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    if (typeof body.resolved_ok !== "boolean") {
      return res
        .status(400)
        .json({ error: "resolved_ok must be true or false." });
    }
    const comment = body.comment ? String(body.comment).trim() : "";
    if (comment.length > MAX_FEEDBACK_COMMENT) {
      return res.status(400).json({
        error: "Comment is too long (max " + MAX_FEEDBACK_COMMENT + " characters).",
      });
    }

    const hospId = activeHospitalId(req);
    if (!hospId) {
      return res
        .status(404)
        .json({ error: "No open feedback request for that report." });
    }
    // An answer is only accepted against a prompt that was actually opened
    // (feedback_requested_at set) and not yet answered — so this can't be used
    // to back-fill feedback on a report that was never asked about.
    const saved = await pool.query(
      `UPDATE reports
          SET feedback_resolved_ok = $1,
              feedback_comment = $2,
              feedback_at = NOW()
        WHERE id = $3 AND user_id = $4 AND hospital_id = $5
          AND feedback_requested_at IS NOT NULL
          AND feedback_at IS NULL
        RETURNING id, hospital_id`,
      [body.resolved_ok, comment || null, id, req.user.id, hospId]
    );
    if (saved.rowCount === 0) {
      // Not their report, wrong hospital, never asked, or already answered.
      return res
        .status(404)
        .json({ error: "No open feedback request for that report." });
    }

    // Mirror the answer into the progress log so staff see it in context.
    await pool.query(
      "INSERT INTO report_updates (report_id, note, author) VALUES ($1, $2, $3)",
      [
        id,
        (body.resolved_ok
          ? "Reporter confirmed this was resolved and the process went well."
          : "Reporter says this is NOT resolved — they still need help.") +
          (comment ? " They added: “" + comment + "”" : ""),
        fullName(req.user),
      ]
    );
    // Negative feedback is news for whoever is looking at a report list.
    if (!body.resolved_ok) {
      broadcast({ type: "reports-changed" }, saved.rows[0].hospital_id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Error saving report feedback:", err);
    res.status(500).json({ error: "Could not save your feedback." });
  }
});

// The follow-on action a reporter picks after saying "no, I still need help":
//   • reopen  — the same report goes back to Open for the team to pick up again
//   • support — it stays resolved, but a follow-up request is logged for staff
//   • related — they're raising a separate report (the form is pre-filled client
//               side); we just note the link on the original
// Only the reporter may do this, and only once they've actually left feedback.
app.post("/api/reports/:id/feedback/next-step", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const action = String((req.body || {}).action || "").trim();
    if (FEEDBACK_NEXT_STEPS.indexOf(action) === -1) {
      return res.status(400).json({ error: "Invalid next step." });
    }

    const hospId = activeHospitalId(req);
    if (!hospId) return res.status(404).json({ error: "Report not found." });
    const owned = await pool.query(
      `SELECT id, hospital_id FROM reports
        WHERE id = $1 AND user_id = $2 AND hospital_id = $3
          AND feedback_at IS NOT NULL`,
      [id, req.user.id, hospId]
    );
    if (owned.rowCount === 0) {
      return res.status(404).json({ error: "Report not found." });
    }
    if (action === "none") return res.json({ ok: true });

    const notes = {
      reopen: "Reporter reopened this report — the issue was not resolved.",
      support: "Reporter asked for follow-up support on this resolved report.",
      related: "Reporter is raising a related report about this issue.",
    };
    if (action === "reopen") {
      await pool.query(
        "UPDATE reports SET status = 'Open', resolved_at = NULL WHERE id = $1",
        [id]
      );
    }
    await pool.query(
      "INSERT INTO report_updates (report_id, note, author) VALUES ($1, $2, $3)",
      [id, notes[action], fullName(req.user)]
    );
    broadcast({ type: "reports-changed" }, owned.rows[0].hospital_id);
    res.json({ ok: true, report: await fetchReportById(id) });
  } catch (err) {
    console.error("Error applying feedback next step:", err);
    res.status(500).json({ error: "Could not action that next step." });
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
  // Tell colleagues in this department to refresh their roster so this user
  // shows as online live (presence is derived from connections, but the staff
  // roster is a snapshot — without this nudge others keep seeing us offline).
  // Skip when the user has no active hospital — a null id would broadcast to all.
  if (res.hospitalId != null) broadcast({ type: "presence" }, res.hospitalId);

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
    // Nudge the department to refresh so this user drops to offline live.
    if (res.hospitalId != null) broadcast({ type: "presence" }, res.hospitalId);
    // If this was the user's last open connection, drop them from any live call
    // so peers see them leave (a closed tab / lost network ends their call).
    const stillOnline = sseClients.some(function (c) { return c.userId === res.userId; });
    if (!stillOnline) {
      Array.from(callRooms.keys()).forEach(function (convId) {
        leaveCall(convId, res.userId);
      });
    }
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
    let statusChanged = false;
    // Anything that changes where a ticket sits on the map, or how it is drawn
    // there, has to reach the heatmap as well as the lists.
    let mapChanged = false;

    if (body.status !== undefined) {
      const status = String(body.status).trim();
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status." });
      }
      statusChanged = true;
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
      mapChanged = true;
      if (priority === "Emergency") {
        raisedEmergency = true;
        // Emergency always means ASAP — force the timeframe/due_at to match so an
        // escalation can't leave a stale, non-ASAP deadline on the report
        // (mirrors the create path). See the Emergency-is-ASAP invariant.
        params.push("ASAP");
        sets.push("timeframe = $" + params.length);
        sets.push("due_at = NOW()");
      }
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

    // Only allow updating reports that belong to the viewer's hospital.
    const hospId = activeHospitalId(req);
    if (!hospId) {
      return res.status(404).json({ error: "Report not found." });
    }

    // Move a ticket to a different room on the floor plan (or unpin it).
    if (body.location_id !== undefined) {
      const resolved = await resolveReportLocation(hospId, body.location_id);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      params.push(resolved.id);
      sets.push("location_id = $" + params.length);
      // Re-pinning is somebody confirming the place by hand, so the
      // "approximate" caveat no longer applies.
      sets.push("location_approx = FALSE");
      mapChanged = true;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
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
    // A status change matters to everyone's list, and resolving is what makes a
    // report eligible for the reporter's feedback prompt — tell the hospital.
    if (statusChanged || mapChanged) {
      broadcast({ type: "reports-changed" }, report.hospital_id);
    }
    res.json(report);
  } catch (err) {
    console.error("Error updating report:", err);
    res.status(500).json({ error: "Could not update report." });
  }
});

// List a report's progress updates (oldest first) so staff can follow progress.
// Serve a report's attached photo as a real image. Kept out of the report JSON
// so lists never carry megabytes of base64; scoped to the viewer's hospital
// exactly like the rest of the by-id routes, so a guessed id leaks nothing.
app.get("/api/reports/:id/photo", requireAuth, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid report id." });
    }
    const id = parseInt(req.params.id, 10);
    const hospId = activeHospitalId(req);
    const row = await pool.query(
      "SELECT photo FROM reports WHERE id = $1 AND hospital_id = $2",
      [id, hospId]
    );
    if (row.rowCount === 0 || !row.rows[0].photo) {
      return res.status(404).json({ error: "No photo for this report." });
    }
    const match = PHOTO_DATA_URL.exec(row.rows[0].photo);
    if (!match) {
      return res.status(404).json({ error: "No photo for this report." });
    }
    const mime = "image/" + (match[1] === "jpg" ? "jpeg" : match[1]);
    const buf = Buffer.from(match[2], "base64");
    // Private: a report photo is hospital data, so it must never be held by a
    // shared cache. The service worker already refuses to cache /api/*.
    res.set("Cache-Control", "private, max-age=300");
    res.set("Content-Type", mime);
    res.set("Content-Length", String(buf.length));
    res.send(buf);
  } catch (err) {
    console.error("Error loading report photo:", err);
    res.status(500).json({ error: "Could not load the photo." });
  }
});

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
        feelingWindows: emptyFeelingWindows(),
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
    // Emotional-feedback breakdown per timeframe: for each feeling, its count
    // within each rolling window (last hour, day, 3 days, …, year). One pass over
    // the table via conditional aggregation; the client stacks these into a single
    // coloured bar per selected timeframe. Intervals come from the fixed
    // FEELING_WINDOWS list only, so inlining them is safe.
    const winCols = FEELING_WINDOWS.map(function (w) {
      return "COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '" +
        w.interval + "')::int AS " + w.id;
    }).join(", ");
    const feelingWin = await pool.query(
      "SELECT feeling, " + winCols +
        " FROM reports WHERE hospital_id = $1 AND feeling IS NOT NULL GROUP BY feeling",
      [hospId]
    );
    // Pivot rows (one per feeling) into an object keyed by window id, each an
    // array of { feeling, count } for feelings actually present in that window.
    const feelingWindows = emptyFeelingWindows();
    feelingWin.rows.forEach(function (row) {
      FEELING_WINDOWS.forEach(function (w) {
        const count = row[w.id];
        if (count > 0) feelingWindows[w.id].push({ feeling: row.feeling, count: count });
      });
    });

    const t = totals.rows[0];
    const avg = resolveTime.rows[0].avg_minutes;
    res.json({
      totals: t,
      byCategory: byCategory.rows,
      byFeeling: byFeeling.rows,
      byPriority: byPriority.rows,
      feelingWindows: feelingWindows,
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
    // Becoming free may free up capacity for reports stuck in Open Reports —
    // try to hand them over right away (fire-and-forget; logs its own errors).
    if (status === "free") sweepUnallocatedReports(activeHospitalId(req));
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
    // A schedule change can change who is free now — re-sweep Open reports.
    sweepUnallocatedReports(activeHospitalId(req));
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
    // Removing a busy window can free someone up — re-sweep Open reports.
    sweepUnallocatedReports(activeHospitalId(req));
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

  // Room/area catalogue. hospital_id NULL = shared default available to every
  // hospital; a row with a hospital_id is that hospital's own custom type.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_types (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      type_group VARCHAR(80) NOT NULL DEFAULT 'Other',
      symbol VARCHAR(40) NOT NULL DEFAULT 'room',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Two partial indexes rather than one UNIQUE(hospital_id, name): NULL never
  // equals NULL in a unique index, so the shared defaults need their own.
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_room_types_global_name ON room_types(name) WHERE hospital_id IS NULL"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_room_types_hosp_name ON room_types(hospital_id, name) WHERE hospital_id IS NOT NULL"
  );
  for (const t of ROOM_TYPE_SEED) {
    await pool.query(
      `INSERT INTO room_types (hospital_id, name, type_group, symbol)
       VALUES (NULL, $1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [t.name, t.group, t.symbol]
    );
  }

  // The layout hierarchy. One self-referencing table for all six levels — see
  // LOCATION_KINDS for why. grid_* is only set for spatial kinds (room /
  // corridor) and positions the block on its floor's plan.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      code VARCHAR(40) NOT NULL,
      room_type_id INTEGER REFERENCES room_types(id) ON DELETE SET NULL,
      grid_x SMALLINT,
      grid_y SMALLINT,
      grid_w SMALLINT,
      grid_h SMALLINT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_hosp_code ON locations(hospital_id, code)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_locations_hosp_kind ON locations(hospital_id, kind)"
  );

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
  // Migration: pin a report to a precise place on the hospital's floor plan.
  // Optional — the free-text `location` remains the fallback, and historic rows
  // simply have no pin. ON DELETE SET NULL so removing a room never deletes
  // tickets (the API also refuses to delete a room that still has any).
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_reports_location_id ON reports(location_id)"
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
  // Migration: optional completion timeframe. Default 'Flexible'; Emergency
  // reports are stamped 'ASAP'. due_at is the concrete deadline (null = none).
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS timeframe VARCHAR(30) NOT NULL DEFAULT 'Flexible'"
  );
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports(assigned_to)"
  );
  // Migration: closing-the-loop feedback. `feedback_requested_at` is the
  // one-shot latch (set the moment the prompt is shown, so it is never shown
  // twice); the rest hold the reporter's answer.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS feedback_requested_at TIMESTAMPTZ"
  );
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS feedback_resolved_ok BOOLEAN"
  );
  // Optional photo of the problem, held as a data URL on the row (same
  // approach as user avatars). Never selected by the list queries — it is
  // served on demand so report lists stay small.
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS photo TEXT");
  // Migration: "I can't identify the room". The reporter names the nearest
  // department or shared area instead of a room, and this flag says so out
  // loud — otherwise a ticket pinned to a whole ward would read as if someone
  // had confirmed the ward was the place, which is a lie the map would repeat.
  await pool.query(
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_approx BOOLEAN NOT NULL DEFAULT FALSE"
  );
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS feedback_comment TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ");
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
  // Per-member role within a conversation: 'owner' (the creator), 'admin'
  // (promoted by the owner — can add people), or 'member'. Backfill existing
  // rows so each conversation's creator is its owner.
  await pool.query(
    "ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member'"
  );
  await pool.query(
    `UPDATE conversation_members cm SET role = 'owner'
       FROM conversations c
      WHERE cm.conversation_id = c.id
        AND cm.user_id = c.created_by
        AND cm.role <> 'owner'`
  );
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

  // Starter floor plans, last so every hospital and room type already exists.
  await seedHospitalLayouts();
}

initSchema()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Friction Aid server running at http://${HOST}:${PORT}`);
    });
    // Continuous re-allocation: keep trying to hand Open reports to whoever is
    // free. This catches capacity that opens up without an explicit event (e.g.
    // a busy window quietly expiring). In-memory timer — safe on the Reserved VM
    // (single always-on instance); see the "Reserved VM only" invariant.
    setInterval(() => sweepUnallocatedReports(), 25000);
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
