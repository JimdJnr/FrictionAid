# Friction Aid — Quick Issue Reporting for Healthcare Staff

A fast, mobile-friendly tool for ward/clinical staff to report everyday friction —
missing linen, hunting for equipment, slow computers, waiting on porters, etc. — in
seconds. Staff sign in with an email + password account (first name, last name,
profession), then dictate the issue with voice-to-text or type it, pick a category,
add a location and priority, and submit. Reports are attributed to the signed-in
staff member's real name and can be reviewed and triaged (Open / In progress /
Resolved).

> This file is a concise overview. It intentionally omits function names, element
> IDs and other detail that is easy to rediscover in the code. What it keeps are the
> durable conventions and non-obvious rules (see **Invariants & gotchas**) that are
> costly to relearn. When in doubt, read the source; when you find a rule that isn't
> obvious from the source, add it to the invariants.

## Architecture

- **Frontend** (`public/`): a vanilla-JS single-page app gated behind a
  sign-in / register screen, laid out in an **Outlook-style shell** — a slim blue
  app bar (waffle menu, app name, centered quick-search, settings gear, avatar), a
  left folder-rail sidebar (compose button + report views) and a scrolling content
  pane. Only the content pane scrolls (mail-client feel). On phones (≤560px) the
  sidebar hides and navigation drops to a fixed bottom bar (Reports / Allocated /
  Open / Insights / More), with compose on a floating FAB. All nav elements carry a
  `data-view` and route through a single `activateView()`; quick-search filters the
  visible cards. Palette/typography follow Outlook (blue `#0f6cbd`, Segoe UI).
- **Backend** (`server.js`): an Express server serving the static frontend and a
  small JSON API. Auth uses email + password accounts with server-side sessions
  (`express-session` + `connect-pg-simple`, backed by a PostgreSQL `session` table).
  Passwords are hashed with scrypt (salt stored alongside the hash). Requires a
  `SESSION_SECRET` env var (a Replit secret). `express.json` uses a 2 MB limit to
  allow avatar data URLs.
- **Database**: Replit-managed **PostgreSQL** (`users`, `reports`,
  `report_updates`, `hospitals`, `availability`, `session`, `conversations`,
  `conversation_members`, `messages` tables).

## Data model

- **`hospitals`**: id, name (unique), password (plaintext, demo only), created_at.
  Seeded from `HOSPITAL_SEED` on boot (INSERT … ON CONFLICT DO NOTHING).
- **`users`**: id, email (unique), password_hash (scrypt), first_name, last_name,
  profession, alias, avatar (data-URL image), hospital_id (FK → hospitals; home
  hospital), theme_color, font_scale, dark_mode, voice_autostart, availability_status
  (`free`/`busy`, default `free`; manual toggle), is_admin (bool, default false;
  true for the seeded shared admin account), access_level (`member`/`it`/`it_lead`,
  default `member`; the management hierarchy — authorization lives here, never in the
  free-text `profession`), created_at.
  The **`admin`** account (login `admin` / `ADMIN123`) is seeded idempotently on
  boot, homed in the **Testing Ground** hospital.
- **`reports`**: id, category, description, location, priority
  (Low/Medium/High/Emergency), department (optional VARCHAR(80), nullable; a routing
  designation the reporter can name — validated against the `DEPARTMENTS` allowlist;
  distinct from `hospital_id`), user_id (FK → users; reporter), hospital_id (FK →
  hospitals; the department, set from the reporter's active hospital on create),
  status (Open/In progress/Resolved), feeling (optional), acknowledged_at,
  acknowledged_by, response_note, outcome, assigned_to (FK → users; auto-allocated
  owner, or NULL = unallocated "Open"), assigned_at, created_at, resolved_at. Legacy
  columns `reporter` / `identity_mode` remain for old rows but are no longer written.
- **`availability`**: id, user_id (FK → users, ON DELETE CASCADE), status
  (`free`/`busy`), starts_at, ends_at, note, created_at. One row per scheduled
  free/busy window; a window covering "now" overrides `availability_status`.
- **`report_updates`**: id, report_id (FK → reports, ON DELETE CASCADE), note,
  author, created_at. `GET /api/reports` returns an `update_count` per report.

## API

All report/insight/event endpoints require a signed-in user (`requireAuth`, which
loads the account into `req.user`). Reports, updates and acknowledgements are
attributed to the signed-in user's real name — the client cannot supply a name.

**Auth & account**
- `POST /api/register` — create an account (`email`, `password` ≥6, `first_name`,
  `last_name`, `profession`) and sign in. 409 on duplicate email.
- `POST /api/login` / `POST /api/logout` — sign in (401 on bad creds) / sign out.
- `GET /api/me` — current account (401 if signed out); drives the app vs sign-in gate.
- `PATCH /api/me` — update the account; every field optional and validated
  (name/profession, alias, avatar data-URL, theme_color, font_scale, dark_mode,
  voice_autostart).

**Hospitals & presence**
- `GET /api/hospitals` — every hospital with staff and home/active flags. The
  plaintext switch `password` is **only** included for `is_admin` accounts (the
  admin panel lists them); non-admins never receive it. Roster only revealed for the
  viewer's own active department.
- `POST /api/hospitals/:id/switch` — switch active department (requires that
  hospital's password); stored in the session.
- `GET /api/staff` — **all** staff in the viewer's active department (home hospital
  OR currently online via SSE), each tagged with `online` (live SSE presence),
  `is_me`, `access_level` and `is_admin`. So the roster shows offline colleagues too,
  with online-first ordering and a live green/grey dot on the client.
- `POST /api/staff` — add a member to the caller's active department (IT / IT Lead
  only; `accessRank ≥ 1`). Reuses the registration validation; new accounts always
  start as a plain `member`. 409 on duplicate email.
- `PATCH /api/staff/:id` — manage a member in the caller's active department. IT+ may
  change `profession`; IT Lead+ (`accessRank ≥ 2`) may also set `access_level`. You
  can only act on someone **strictly below** your own rank and only grant a role
  **below** your own rank; you can't edit yourself here (use `PATCH /api/me`).
  Hospital-scoped (404 otherwise).

**Messaging (Teams-like DMs & groups)**
- `GET /api/conversations` — the caller's conversations (member-only, active-hospital
  scoped), each with members, `last_message`, and an `unread` count; newest-activity
  first.
- `POST /api/conversations` — start a conversation. `member_ids` (validated to the
  active department, home or online), optional `is_group` + `title`. DMs are deduped
  (an existing 1:1 is returned). Emits SSE `type:"conversation"` to invitees.
- `GET /api/conversations/:id/messages` — list messages (member-only) and mark the
  thread read for the caller.
- `POST /api/conversations/:id/messages` — send a message; emits SSE
  `type:"message"` to all members for live delivery + unread badges.

**Reports & insights**
- `POST /api/reports` — create (`category`, `description`, `location`, `priority`,
  optional `feeling`, optional `department` — validated against `DEPARTMENTS`, nulled
  if off-list). Stamped with the reporter's active hospital and
  **auto-allocated** via `pickAssignee()` (see Availability), or left Open. Emergency
  broadcasts via SSE. Returns the row joined to the assignee.
- `GET /api/reports` — list, joined to reporter + assignee, **scoped to the active
  hospital**. Query params: `status`/`priority`/`category` filters; `sort=urgency`;
  `bucket=resolved` (resolved 2+ min ago), `bucket=allocated` (has assignee),
  `bucket=open` (no assignee). Default: newest-first, emergencies pinned, long-resolved
  hidden.
- `PATCH /api/reports/:id` — update status/priority/acknowledgement/outcome/assigned_to.
  Hospital-scoped (404 otherwise). `assigned_to` accepts only the caller's own id
  (claim/take-over) or `null` (release). Resolving stamps `resolved_at`.
- `GET`/`POST /api/reports/:id/updates` — list / add a timestamped progress update.
  Hospital-scoped.
- `GET /api/insights` — aggregates scoped to the active hospital (totals, counts by
  category/feeling/priority, avg time-to-resolve, acknowledgement rate, updates).
- `GET /api/events` — SSE stream; pushes emergency events for real-time notifications.
- `POST /api/assist` — AI helper for "Talk it through" (OpenAI via keyless Replit AI
  Integrations; 503 if unset). Extracts category/location/priority/feeling/department,
  re-validated server-side, and **never** sets Emergency (capped at High). Department
  is only extracted when the reporter clearly names one (never asked for).

**Availability & auto-allocation**
- `GET`/`PATCH /api/availability` — the caller's status + windows / set manual status.
- `POST`/`DELETE /api/availability/windows[/:id]` — add / remove a scheduled window.
- `GET /api/availability/team` — the active hospital's effective free/busy roster.
- Allocation: `effectiveFreeUserIds()` computes who's free now (a busy window covering
  "now" beats a free window beats manual status, default `free`). `pickAssignee()`
  first narrows to free colleagues whose **profession** handles the report's category
  (`CATEGORY_PROFESSIONS`), falling back to the whole free pool if none match; then
  prefers a non-reporter, then someone online (live SSE), then the fewest active
  assignments; NULL → Open.

## Features (summary)

Read the source for detail; these are the behaviours worth knowing exist.

- **Multi-step report wizard**: guided steps — Describe (voice + text + category
  grid), Where (location + urgency), Feel (shown only when priority is not Low). Low
  issues submit from step 2; Emergency needs a two-step confirm.
- **Voice input**: one target-aware `SpeechRecognition` engine points at
  description / location / feeling. Final chunks pass through healthcare speech
  correction (ward-vocabulary mishearings) and, on location/feeling, spoken
  self-corrections ("no I meant …") replace rather than append.
- **Mobile hands-free flow**: on phones, dictating the description chains through the
  wizard and auto-submits — silence-timer driven, each step prompted at most once
  (spoken aloud), any manual nav hands control back. A voice-coach bar narrates it;
  the auto-submit announces itself (amber toast + spoken). Emergency is never
  auto-set, so auto-submit can't fire a broadcast.
- **Smart capture**: the description is parsed to pre-fill category / priority /
  feeling / location / department, but only for untouched fields (manual choices win).
- **Optional department designation**: reporters can route a problem to a specific
  team. It's never required — an optional dropdown on the Where step (default "No
  specific department") that auto-fills when the reporter names a department while
  describing the issue (client `detectDepartment()` keyword scoring, or the AI
  assist). A manual pick sets `manualDepartment` so auto-fill leaves it alone. Shown
  on report cards only when set.
- **Talk it through (AI)**: a chat that asks one follow-up at a time and auto-fills
  via the same setters; degrades gracefully when the AI is unavailable.
- **Report lifecycle**: Emergency pins to top and flashes a banner + tone in every
  open browser via SSE; emergency-sensitive actions need a confirming second click;
  resolved reports linger 2 min then move to the Resolved tab (can be unresolved).
- **Availability, schedule & auto-allocation**: a My-schedule view (manual free/busy
  toggle, voice availability, scheduled windows, "who's free now" roster). Reports
  auto-allocate to a free colleague (Open if none). Allocated view is grouped per
  assignee (mine first). Claim / Release / Take-over per card (server enforces
  self-only assignment).
- **Attribution, feeling & acknowledgement**: every report/update/ack carries the
  staff member's real name; an optional feeling chip (negative *and* positive
  options, so staff can flag what went well too); reviewers can acknowledge +
  respond, closing the "was my concern seen?" loop.
- **Transparency ("black box" gap)**: instant human-friendly reference (`WR-0001`);
  display-only escalation routes per category; expandable progress-update log;
  visible outcomes on resolve; Insights dashboard.
- **Hospitals & staff presence**: per-hospital isolation centralised in
  `activeHospitalId(req)` (active dept → home hospital → null hides everything). The
  staff roster shows the whole department — offline colleagues included — with a live
  green/grey presence dot from SSE and online-first ordering.
- **Messaging**: a Teams-like Messages view — 1:1 DMs and named group chats, all
  scoped to the active department. Start a conversation from a people picker with a
  profession filter; unread counts drive a nav badge; new messages/conversations
  arrive live over the shared `/api/events` SSE stream. Reuses `/api/staff` for the
  picker, so only same-department colleagues are reachable.
- **Management hierarchy**: a role ladder `member < it < it_lead` (with the seeded
  admin above all). On the Staff view, IT and IT Lead see an "Add member" card and
  per-colleague manage controls (a profession dropdown, plus a role dropdown for IT
  Lead / admin). Controls appear only for people below the viewer's rank and auto-save
  on change. Authorization lives in the `access_level` column, not the free-text
  profession, so it can't be self-assigned at registration.
- **Profession dropdown**: register and profile choose a role from a curated
  dropdown; "Other" reveals a free-text field. Stored as the plain string, so any
  role is still possible.
- **Profile & settings**: edit details + avatar; appearance (theme colour, font
  size, dark mode) persisted per-user and applied instantly; autostart-voice opt-in.
- **Admin & testing ground**: a "Testing Ground" sandbox hospital plus a shared
  admin account (`admin` / `ADMIN123`) so admins can trial the whole reporting flow
  without touching real ward data. The Profile view has an "Admin & testing ground"
  card that signs into the admin account (POST `/api/login`, then reload) and, for
  the admin, a "Reset testing ground" button (`POST /api/testing-ground/reset`,
  admin-only) that deletes every report in that department for a clean slate.
- **Describe helpers**: an auto-fill hint, a clear button, a "please describe it"
  prompt, and spoken "you skipped this" nudges (each optional field nudged at most
  once so a reporter can still skip).

## UI/UX

- **Reports as expanding "emails"**: each card shows a compact row (avatar, category,
  timestamp, reporter, snippet, badges); a hidden body (a `0fr→1fr` grid reveal)
  holds the full detail. Expands on hover/focus (desktop) and tap (touch). The row
  is a keyboard-operable disclosure (`role="button"`, Enter/Space, `aria-expanded`).
- **Accessibility (WCAG 2.2 AA)**: one `<h1>` per screen; `role="alert"` live regions
  for form/auth messages; labelled controls and `role="group"` for urgency;
  single-select chip rows reflect `aria-pressed`; the wizard stepper uses
  `aria-current="step"`; `:focus-visible` outlines; icon-only buttons carry `title`;
  `.sr-only` is the shared visually-hidden utility.
- **Motion & polish**: a light, fast motion layer in `style.css`, all disabled under
  `prefers-reduced-motion` — staggered view/step entrances, card fade/slide-in,
  sliding panels, popping status messages, the dropping emergency banner.
- **Responsive**: phone (≤560px) bottom nav + large mic + 16px inputs; tablet
  (561–900px) narrower rail + two-column grids; desktop (>900px) full rail, waffle
  toggles the rail.
- **Installable app (PWA)**: manifest + icons + a service worker (see caching
  invariant). Installs via the browser's own control (no in-app button). The same
  `index.html` installs as **two apps** via a `?launch=` param, each with its own
  manifest (distinct `id`/`name`/`start_url`) and on-open behaviour — Quick Report
  (compose + immediate listening) and Ward Insights (Insights dashboard). An inline
  head script sets `window.__LAUNCH_MODE` and swaps the manifest link before `app.js`;
  `showApp()` branches on it.

## Invariants & gotchas

These are the non-obvious rules that keep the app working — break one and something
fails silently.

- **Authorization is `access_level`, not profession**: the management ladder
  (`member < it < it_lead`, admin above via `is_admin`) is enforced by `accessRank()`
  in `server.js`. `/api/staff` (POST/PATCH) checks it server-side: you may only manage
  someone strictly below your rank and only grant a role below your own rank, never
  yourself. The client's mirror (`accessRank`/`ACCESS_LABELS` in `app.js`) only
  shows/hides controls — never trust it. `access_level` is never writable via
  registration or `PATCH /api/me`.
- **`assigned_to` is self-only**: `PATCH /api/reports/:id` accepts `assigned_to` only
  as the caller's own id (claim / take-over) or `null` (release). Auto-allocation in
  `pickAssignee()` is the only path that picks someone else, server-side.
- **Effective-free precedence**: a `busy` window covering "now" always beats a `free`
  window and the manual `availability_status`; with no covering window the manual
  status applies (default `free`). Keep this ordering in `effectiveFreeUserIds()`.
- **Nav view registry sync**: every new view needs a `data-view` element in **both**
  the sidebar rail and the mobile bottom nav / More sheet, and (if secondary) an
  entry in `MORE_VIEWS`, or the view is unreachable on one form factor.
- **Allowlist sync**: `CATEGORIES`, `FEELINGS`, `CATEGORY_PROFESSIONS` and
  `DEPARTMENTS` live in **both** `app.js` and `server.js`. Edit them together or
  new-category reports are rejected, feelings silently dropped, profession-based
  allocation misfires, or a designated department is silently nulled server-side.
  `DEPARTMENT_KEYWORDS` (the detection map) is client-only, but its `name`s must match
  the shared `DEPARTMENTS` list.
  `ROUTES` is client-only but its keys must match `CATEGORIES`. `FEELINGS` mixes
  negative "friction" feelings and positive ones (a client-only `tone` field tints
  the positive chips green); the server list is names only.
- **Theme recolours via inline vars**: `applyPreferences()` derives a whole tinted
  palette (`--bg`, `--card`, `--line*`, `--brand-soft`, the `--ol-*` shell tokens,
  `--brand-strong`) from the chosen `theme_color` and sets them **inline on
  `documentElement`**. Those inline styles deliberately override the `:root` /
  `html[data-theme="dark"]` blocks in `style.css`, so surface colours should be read
  from CSS variables (never hard-coded) or the theme won't reach them.
- **Hospital scoping / IDOR**: every read/write touching reports must be constrained
  to the viewer's active hospital — including the **by-id** routes, not just lists.
- **Live SSE presence, no parallel store**: presence is derived directly from open
  `/api/events` streams (tagged with userId + hospitalId). Do **not** reintroduce a
  separate presence map — it drifts. Scope staff by active-department presence, not
  home hospital, or switched-in colleagues vanish.
- **Re-tag SSE on department switch**: a live `/api/events` connection's
  userId/hospitalId tag goes stale when a user switches department mid-session, so the
  switch endpoint re-tags all that user's SSE clients (else old-hospital emergencies
  leak). Any per-connection tag that can change must be refreshed the same way.
- **Emergency is never auto-set**: `detectPriority` and the AI assist cap at High.
  Emergency stays a manual, two-step-confirmed choice so free text can't broadcast.
- **Wizard steps avoid `.hidden !important`**: view switching uses `.hidden`
  (`display: none !important`) — the `!important` is required because the desktop
  layout targets `#reportView { display: grid }` by **ID**, whose specificity would
  otherwise beat a plain class (the "new section appears at the bottom" bug). Wizard
  steps toggle their own `:not(.active){display:none}` to sidestep the same clash.
- **Card entrance fill-mode**: entrance keyframes on elements that also hover-transform
  must use `animation-fill-mode: backwards`, not `both`, or the hover lift dies.
- **Service worker caching**: `/api/*` (including SSE) is **never** cached (always
  network). Navigations and code assets (`app.js`, `style.css`) are network-first with
  a cached fallback; only icons/manifest are cache-first. **Bump the `CACHE` version in
  `sw.js` whenever shell assets change** — the SW uses `skipWaiting()` + `clients.claim()`
  and reloads the tab once on `controllerchange`. Skipping the bump leaves standalone
  tabs running stale `app.js`/`style.css` after a deploy.
- **Reserved VM only, not Autoscale**: presence and emergency SSE rely on in-memory
  `sseClients`. Autoscale runs multiple instances (separate memory), so users on
  different instances wouldn't see each other. Keep `.replit` `deploymentTarget = "vm"`.
- **Passwords in plaintext (demo)**: hospital passwords are stored and returned in
  plaintext for the demo — hash them before any real deployment.
- **Voice needs Chromium in its own tab**: Web Speech API needs Chrome/Edge/Brave in a
  real tab (mic is blocked in embedded preview iframes); on Windows, Edge needs "Online
  speech recognition" enabled. Typing always works as a fallback.

## Project layout

- `server.js` — Express server + REST API (port 5000).
- `public/index.html` — app markup; registers the SW; PWA meta tags + launch-mode script.
- `public/app.js` — categories, feelings, routes, wizard controller, voice input,
  smart capture, report list, progress updates, insights.
- `public/style.css` — styling and the motion layer.
- `public/sw.js` — service worker (never caches `/api/*`).
- `public/manifest*.webmanifest` — PWA manifests (default + two launch modes).
- `public/icons/` — PWA / home-screen icons.

## Running & deployment

- **Running**: the "Start application" workflow runs `npm start` (`node server.js`) on
  port 5000.
- **Deployment**: **Reserved VM** (`npm start`) backed by managed PostgreSQL. A VM
  (single always-on instance) is required — see the "Reserved VM only" invariant.

## User preferences

- The app is a healthcare issue-reporting aid centered on quick voice/typed reporting.
  Keep it focused on fast, low-friction reporting for ward staff.
