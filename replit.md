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
  `priority`, `reporter`).
- `GET /api/reports?status=` — list the 100 most recent reports, optionally
  filtered by status.
- `PATCH /api/reports/:id` — update a report's status.

## Data model

`reports`: id, category, description, location, priority (Low/Medium/High),
reporter, status (Open/In progress/Resolved), created_at.

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

## Running

The "Start application" workflow runs `npm start` (`node server.js`) on port 5000.

## Deployment

Autoscale deployment (`npm start`), backed by the managed PostgreSQL database.

## User preferences

- The app is a healthcare issue-reporting aid centered on quick voice/typed
  reporting. Keep it focused on fast, low-friction reporting for ward staff.
