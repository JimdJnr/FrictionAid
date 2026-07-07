# Ward Report — Quick Issue Reporting for Healthcare Staff

A fast, mobile-friendly tool for ward/clinical staff to report everyday friction —
missing linen, hunting for equipment, slow computers, waiting on porters, etc. —
in seconds. Staff can **dictate** the issue with voice-to-text or type it, pick a
common category, add a location and priority, and submit. Submitted reports are
stored and can be reviewed and triaged (Open / In progress / Resolved).

## How it works

- **Frontend** (`public/`): a two-tab single-page app — "New report" and
  "Recent reports". Voice input uses the browser's **Web Speech API**
  (`SpeechRecognition` / `webkitSpeechRecognition`); typing always works as a
  fallback.
- **Backend** (`server.js`): an Express server serving the static frontend and a
  small JSON API.
- **Database**: Replit-managed **PostgreSQL** (`reports` table).

## API

- `POST /api/reports` — create a report (`category`, `description`, `location`,
  `priority`, `reporter`, optional `feeling`). Broadcasts an emergency event if
  `priority` is `Emergency`. `feeling` is validated against a `FEELINGS`
  allowlist; anything else is stored as null.
- `GET /api/reports` — list reports. Optional query params:
  - `status`, `priority`, `category` — filters (validated against allowlists).
  - `sort=urgency` — order by Emergency > High > Medium > Low, then newest
    ("All reports" view). Default is newest-first with emergencies pinned to top.
  - `bucket=resolved` — only reports resolved for 2+ minutes ("Resolved
    reports" view). Default (`active`) hides those long-resolved reports.
- `PATCH /api/reports/:id` — update a report's `status` and/or `priority`, and/or
  its acknowledgement. Resolving sets `resolved_at`; any non-resolved status
  clears it. Escalating to `Emergency` priority broadcasts an emergency event.
  `acknowledged` (strict boolean) records/clears that the report was seen:
  `true` stamps `acknowledged_at` and optionally saves `acknowledged_by` and a
  short `response_note`; `false` clears all three.
- `GET /api/events` — Server-Sent Events stream; pushes `{type:"emergency"}`
  events to every connected client for real-time notifications.

## Data model

`reports`: id, category, description, location, priority
(Low/Medium/High/Emergency), reporter, status (Open/In progress/Resolved),
feeling (optional reporter emotion), acknowledged_at, acknowledged_by,
response_note, created_at, resolved_at.

## Report lifecycle & notifications

- **Emergency**: staff can create an Emergency report or escalate any existing
  report to Emergency. Emergencies are pinned to the top of "Recent reports" and,
  via SSE, every open browser shows a flashing banner + alert tone.
- **Two-step confirmation for emergency actions**: to guard against misclicks,
  emergency-sensitive actions require a confirming second click. Selecting the
  Emergency priority on a new report and the per-card "🚨 Mark emergency" button
  arm on first click ("Click again to confirm") and only fire on the second.
  For emergency reports specifically, resolving one (via the status buttons)
  shows an inline "Confirm resolve / Cancel" strip, and reviving/unresolving one
  requires a confirming second click. Non-emergency resolve/unresolve stay
  single-click.
- **Resolved reports**: when a report is marked Resolved it stays in the active
  lists for 2 minutes (`RESOLVE_DELAY_MINUTES`), then moves to the dedicated
  "Resolved reports" tab. From there it can be unresolved (re-opened).

## Reporter feeling & acknowledgement

- **How did this make you feel? (optional)**: on the New Report form the reporter
  can tap one feeling chip (Frustrated / Embarrassed / Resentful / Undervalued /
  Helpless / Cynical) or leave it blank. Tapping the selected chip again clears
  it. The chosen feeling shows as a small tag on the report card. The `FEELINGS`
  allowlist lives in both `server.js` and `public/app.js` and must stay in sync.
- **Acknowledge / respond**: on active report cards a reviewer can acknowledge a
  report and optionally record their name and a short response. Acknowledged
  reports show a green "✓ Acknowledged" pill plus the response note (or "Seen and
  acknowledged.") with who/when. Acknowledgement can be cleared. This closes the
  "was my concern seen?" loop for frontline staff.

## Browser support for voice

Voice dictation needs a Chromium browser (Chrome, Edge, Brave) opened in its own
tab (microphone access is blocked inside embedded preview iframes). On Windows,
"Online speech recognition" must be enabled for Edge's speech service. Typing works
in every browser regardless.

## Project layout

- `server.js` — Express server + REST API (port 5000).
- `public/index.html` — app markup.
- `public/style.css` — styling.
- `public/app.js` — categories, form, voice input, and report list logic.
  The issue-type list lives here **and** in `server.js` (`CATEGORIES` allowlist);
  the two must stay in sync or new-category reports are rejected. If a typed/spoken
  description matches no specific type, it's auto-filed under "Other" so nothing is
  lost.

## Running

The "Start application" workflow runs `npm start` (`node server.js`) on port 5000.

## Deployment

Autoscale deployment (`npm start`), backed by the managed PostgreSQL database.

## User preferences

- The app is a healthcare issue-reporting aid centered on quick voice/typed
  reporting. Keep it focused on fast, low-friction reporting for ward staff.
