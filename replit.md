# Friction Aid — Quick Issue Reporting for Healthcare Staff

A fast, mobile-friendly tool for ward/clinical staff to report everyday friction —
missing linen, hunting for equipment, slow computers, waiting on porters, etc. —
in seconds. Staff **sign in with an email + password account** (first name, last
name, profession), then **dictate** the issue with voice-to-text or type it, pick
a common category, add a location and priority, and submit. Reports are attributed
to the signed-in staff member's real name and can be reviewed and triaged
(Open / In progress / Resolved).

## How it works

- **Frontend** (`public/`): a single-page app gated behind a sign-in / register
  screen. Once authenticated it shows the tabbed reporting UI ("New report",
  "Recent reports", etc.) plus a header user chip (name · profession · Log out).
  Voice input uses the browser's **Web Speech API** (`SpeechRecognition` /
  `webkitSpeechRecognition`); typing always works as a fallback.
- **Backend** (`server.js`): an Express server serving the static frontend and a
  small JSON API. Auth uses **email + password accounts** with server-side
  sessions (`express-session` + `connect-pg-simple`, backed by a PostgreSQL
  `session` table). Passwords are hashed with scrypt (salt stored alongside the
  hash). Requires a `SESSION_SECRET` env var (kept as a Replit secret).
- **Database**: Replit-managed **PostgreSQL** (`users`, `reports`,
  `report_updates`, `session` tables).

## Authentication

All report/insight/event endpoints require a signed-in user (`requireAuth`
middleware, which loads the account into `req.user`). Reports, progress updates,
and acknowledgements are attributed to the signed-in user's real name — the
client can no longer supply an arbitrary name.

- `POST /api/register` — create an account (`email`, `password` [≥6 chars],
  `first_name`, `last_name`, `profession`) and sign in. 409 on duplicate email
  (also caught via PG unique-violation `23505`).
- `POST /api/login` — sign in (`email`, `password`); 401 on bad credentials.
- `POST /api/logout` — destroy the session and clear the `connect.sid` cookie.
- `GET /api/me` — the current account (401 if not signed in). Used on load to
  decide between the app and the sign-in screen.

## API

- `POST /api/reports` — create a report (`category`, `description`, `location`,
  `priority`, optional `feeling`). Attributed to the signed-in user via
  `user_id`. Broadcasts an emergency event if `priority` is `Emergency`.
  `feeling` is validated against a `FEELINGS` allowlist; anything else is null.
- `GET /api/reports` — list reports (joined to `users` for reporter name /
  profession). Optional query params:
  - `status`, `priority`, `category` — filters (validated against allowlists).
  - `sort=urgency` — order by Emergency > High > Medium > Low, then newest
    ("All reports" view). Default is newest-first with emergencies pinned to top.
  - `bucket=resolved` — only reports resolved for 2+ minutes ("Resolved
    reports" view). Default (`active`) hides those long-resolved reports.
- `PATCH /api/reports/:id` — update a report's `status`, `priority`,
  acknowledgement, and/or `outcome`. Resolving sets `resolved_at`; any
  non-resolved status clears it. Escalating to `Emergency` priority broadcasts an
  emergency event. `acknowledged` (strict boolean) records/clears that the report
  was seen: `true` stamps `acknowledged_at` and `acknowledged_by` (always the
  signed-in reviewer's name) plus an optional `response_note`; `false` clears all
  three. `outcome` records/clears a visible "what was done" note (usually
  captured when resolving).
- `GET /api/reports/:id/updates` — list a report's progress updates (oldest
  first).
- `POST /api/reports/:id/updates` — add a timestamped progress update
  (`note` required; `author` is always the signed-in user). 404 if the report
  doesn't exist.
- `GET /api/insights` — aggregate stats for organisational learning: totals
  (open/in-progress/resolved/emergencies/acknowledged), counts by category,
  feeling, and priority, average time-to-resolve (minutes), acknowledgement rate,
  and total progress updates.
- `GET /api/events` — Server-Sent Events stream; pushes `{type:"emergency"}`
  events to every connected client for real-time notifications.

## Data model

`users`: id, email (unique), password_hash (scrypt), first_name, last_name,
profession, created_at.

`reports`: id, category, description, location, priority
(Low/Medium/High/Emergency), user_id (FK → users; the reporting account),
status (Open/In progress/Resolved), feeling (optional reporter emotion),
acknowledged_at, acknowledged_by, response_note, outcome (visible "what was done"
note), created_at, resolved_at. (Legacy columns `reporter` / `identity_mode`
remain on the table for old rows but are no longer written; new cards derive the
reporter name from the joined `users` row, falling back to the legacy `reporter`
then "Staff".)

`report_updates`: id, report_id (FK → reports, ON DELETE CASCADE), note, author,
created_at. One row per progress update; `GET /api/reports` returns an
`update_count` per report via a correlated subquery.

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
  report and optionally add a short response. The reviewer's name is taken from
  their signed-in account (not typed). Acknowledged reports show a green
  "✓ Acknowledged" pill plus the response note (or "Seen and acknowledged.") with
  who/when. Acknowledgement can be cleared. This closes the "was my concern
  seen?" loop for frontline staff.

## Reporter attribution

Reports are tied to a signed-in account, so every report, progress update, and
acknowledgement carries the staff member's real name. `reporterByline()` on each
card shows "by First Last · Profession" from the joined `users` row, falling back
to the legacy free-text `reporter` (old rows) and then "by Staff". The emergency
banner shows the reporter's first name.

## Closing the "black box" gap

Frontline staff often feel reports vanish into a black box. Five features make
the process transparent end-to-end:

- **Instant reference number**: on submit the reporter is told their report is
  logged with a human-friendly reference (`WR-0001`, from the report id). The
  reference also shows on every report card, so a report is never anonymous.
- **Transparent escalation routes**: each issue type maps to an owning team
  (the `ROUTES` map in `public/app.js`). The New Report form shows "This goes
  to: …" once a category is chosen, and each card shows a "Routes to …" tag.
  This is display-only (no schema change); `ROUTES` keys must match `CATEGORIES`.
- **Progress update log**: each report has an expandable, timestamped update log
  ("📝 Progress updates (n)"). Anyone can post an update (optional author). The
  card shows the running count; the panel lazy-loads the log on first open.
- **Visible outcomes**: resolving a report opens an inline form to capture an
  optional `outcome` ("what was done"). Because outcome capture lives here, all
  resolves (not just emergencies) now use a one-click confirm form. Resolved
  cards also have an "Add/Edit outcome" button. The outcome shows in a green
  block on the card.
- **Insights & learning**: an "Insights" tab summarises volumes, how reporters
  felt, priority mix, average time-to-resolve, acknowledgement rate, and total
  progress updates — turning individual reports into organisational learning.

## Smart capture (auto-fill from the description)

To keep reporting fast, the "Describe it" text (typed **or** dictated) is parsed
to pre-fill the rest of the form. All parsing lives in `public/app.js`:

- **What it detects**: category (existing `autoCategorize`), **priority/urgency**
  (`detectPriority` — urgent language → High, low-priority language → Low),
  **feeling** (`detectFeeling` against `FEELING_KEYWORDS`, mapped to the
  `FEELINGS` allowlist), and **location/ward** (`detectLocation` — chained
  "ward/bay/bed/room/floor/level…" + number spans, ordinal floors ("3rd floor"),
  and named areas like "Resus", "A&E", "Radiology", "Corridor"). Reporter name is
  no longer parsed from the text — it comes from the signed-in account.
- **Never overrides manual choices**: `maybeAutoFill` only writes to fields the
  reporter hasn't touched, tracked by `manualPriority` / `manualFeeling` /
  `manualLocation`. Programmatic `.value` writes don't fire `input` events, so
  auto-fill never trips these flags. All flags reset in `resetForm`. An
  "Auto-filled from your words: …" note (`#autofillNote`) tells the reporter what
  was set so they can correct it.
- **Emergency is deliberately never auto-set**: `detectPriority` only ever yields
  Low/Medium/High. Emergency stays a manual, two-step-confirmed choice so free
  text can't silently fire an emergency broadcast. Urgent language maps to High.
- **Robustness**: priority matching checks the Low list first, uses word-boundary
  matching (so "urgent" doesn't fire inside "insurgent"), and strips negated
  urgency ("not an emergency", "isn't urgent") before scanning the High list.

## "Please describe it" prompt

If the reporter engages another field (category, priority, feeling, location)
or tries to submit while the description is still empty, an amber
prompt (`#descPrompt`) nudges them to describe the issue first. It's gated on the
description being empty and hides as soon as they focus/type the description.

## Describe-section helpers

- **Auto-fill hint (`#descHint`)**: a persistent info banner above the textarea
  tells reporters they can just describe the issue in their own words and mention
  the ward, urgency, or feeling to have the form auto-filled. This makes the
  smart-capture feature discoverable (it's easy to miss that mentioning a ward is
  what triggers the fill).
- **Clear button (`#clearDescBtn`)**: a pill button overlaid on the top-right of
  the description textarea, shown only when the description has content
  (`updateClearBtn`). Clicking it empties the description and re-runs
  `handleDescriptionChange`, which clears anything auto-filled from the text
  (untouched fields) while leaving hand-set choices intact, then refocuses the
  textarea. Also hidden on `resetForm`.

## Motion & polish

The UI uses a light, fast motion layer for a professional feel — all defined in
`public/style.css` and all disabled under `prefers-reduced-motion`:

- **View/tab transitions**: switching tabs re-triggers a staggered "rise in"
  fade-up on the shown view's direct children. `animateViewIn()` in
  `public/app.js` does a remove → forced reflow → re-add of the `animate-in`
  class so the animation replays every switch (also fired once on first paint).
- **Report cards**: each card fades/slides in with a per-index stagger
  (`animationDelay` set inline in `renderReports`, capped so long lists don't
  crawl). The card entrance uses `animation-fill-mode: backwards` (not `both`)
  so it doesn't pin `transform` and kill the hover lift.
- **Panels & inline forms**: progress-update panels, acknowledge/resolve/outcome
  forms, and the emergency confirm strip slide/fade open (`expandIn`).
- **Feedback**: the form status message pops in (`popIn`), the emergency banner
  drops in from the top (`bannerDrop`) then keeps its flash, and Insights stats
  pop in while bars grow from the left.
- Micro-interactions add subtle hover lift/press on chips and buttons, plus a
  consistent `:focus-visible` ring for keyboard users.

## Installable app (PWA)

Friction Aid is a **Progressive Web App**, so staff can install it to their phone
home screen and run it full-screen like a native app.

- **Manifest** (`public/manifest.webmanifest`): name, theme/background colours
  (`#0d6b7a`), `display: standalone`, and the app icons.
- **Icons** (`public/icons/`): `icon-192.png`, `icon-512.png`, a full-bleed
  `icon-maskable-512.png` (Android adaptive icons), and `apple-touch-icon.png`
  (iOS home screen). Generated from the brand mark (teal square + white plus).
- **Service worker** (`public/sw.js`): caches the app shell (`index.html`,
  `style.css`, `app.js`, icons, manifest) for fast loads and offline access.
  Requests to `/api/*` (including the SSE stream) are **never cached** — always
  network — so reports, auth and emergency events stay live. Navigations are
  network-first with a cached-shell fallback when offline. Bump the `CACHE`
  version string in `sw.js` when shell assets change so clients pick them up.
- **Meta tags & safe areas** (`public/index.html`, `public/style.css`): iOS/
  Android PWA meta tags, `viewport-fit=cover`, and `env(safe-area-inset-*)`
  padding on the top bar and content so nothing sits under a phone notch or the
  home indicator in standalone mode.
- **Install button** (`#installBtn`): on Android/Chrome/desktop, a floating
  "Install app" button appears when the browser fires `beforeinstallprompt` and
  triggers the native install prompt. iOS installs via Share → Add to Home
  Screen (no button; that's the platform convention).

## Browser support for voice

Voice dictation needs a Chromium browser (Chrome, Edge, Brave) opened in its own
tab (microphone access is blocked inside embedded preview iframes). On Windows,
"Online speech recognition" must be enabled for Edge's speech service. Typing works
in every browser regardless.

## Project layout

- `server.js` — Express server + REST API (port 5000).
- `public/index.html` — app markup (also registers the service worker + install
  button and carries the PWA meta tags).
- `public/manifest.webmanifest` — PWA manifest.
- `public/sw.js` — service worker (app-shell cache; never caches `/api/*`).
- `public/icons/` — PWA/home-screen icons.
- `public/style.css` — styling.
- `public/app.js` — categories, feelings, escalation routes, form, voice input,
  report list logic, progress updates, and the insights view. The issue-type list
  (`CATEGORIES`) and the reporter feelings (`FEELINGS`) live here **and** in
  `server.js` (both are server-side allowlists) — they must stay in sync or
  new-category reports are rejected / feelings silently dropped. The `ROUTES`
  escalation map is client-only but its keys must match `CATEGORIES`. If a
  typed/spoken description matches no specific type, it's auto-filed under "Other"
  so nothing is lost.

## Running

The "Start application" workflow runs `npm start` (`node server.js`) on port 5000.

## Deployment

Autoscale deployment (`npm start`), backed by the managed PostgreSQL database.

## User preferences

- The app is a healthcare issue-reporting aid centered on quick voice/typed
  reporting. Keep it focused on fast, low-friction reporting for ward staff.
