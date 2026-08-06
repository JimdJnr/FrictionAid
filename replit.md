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
  app bar (waffle menu, app name, left-packed quick-search, settings gear, avatar
  — the search does not grow, so the settings/profile cluster sits toward the left
  rather than pinned to the right edge), a
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
- **`room_types`**: id, hospital_id (FK → hospitals, **nullable**), name, type_group,
  symbol. `hospital_id IS NULL` = a shared default type available to every hospital;
  a row with a hospital_id is that hospital's own custom type. Uniqueness is two
  *partial* indexes (one `WHERE hospital_id IS NULL`, one `WHERE hospital_id IS NOT
  NULL`) rather than one composite index, because NULL never equals NULL in a unique
  index. `symbol` names a glyph family so the map can encode room type without colour.
- **`locations`**: **one self-referencing table** for the whole seven-level place
  hierarchy (hospital → building → wing → floor → department → corridor → room), not
  a table per level. Columns: id, hospital_id, parent_id (FK → locations, nullable =
  a top-level building), kind, name, code, room_type_id, grid_x/grid_y/grid_w/grid_h,
  sort_order, active. Only `corridor` and `room` are *spatial* (drawn on the plan).
  Floor membership is derived with recursive CTEs, never a denormalised `floor_id`.
- **`reports`**: id, category, description, location, location_id (FK → locations,
  nullable, `ON DELETE SET NULL`; an **optional** precise pin — free-text `location`
  stays the fallback), priority
  (Low/Medium/High/Emergency), department (optional VARCHAR(80), nullable; a routing
  designation the reporter can name — validated against the `DEPARTMENTS` allowlist;
  distinct from `hospital_id`), user_id (FK → users; reporter), hospital_id (FK →
  hospitals; the department, set from the reporter's active hospital on create),
  status (Open/In progress/Resolved), feeling (optional), acknowledged_at,
  acknowledged_by, response_note, outcome, assigned_to (FK → users; auto-allocated
  owner, or NULL = unallocated "Open"), assigned_at, timeframe (VARCHAR(30), default
  `Flexible`; the reporter's requested completion window — validated against
  `TIMEFRAMES`, Emergency always forced to `ASAP`), feedback_requested_at (the
  one-shot latch for the post-resolution feedback prompt), feedback_resolved_ok
  (BOOLEAN; the reporter's yes/no), feedback_comment, feedback_at, due_at (TIMESTAMPTZ, nullable;
  `created_at + TIMEFRAME_HOURS[timeframe]`, NULL for Flexible), created_at,
  resolved_at. Legacy columns `reporter` / `identity_mode` remain for old rows but
  are no longer written.
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
  (an existing 1:1 is returned). The creator is stored as the `owner`, everyone else
  as `member` (per-member role on `conversation_members`). Emits SSE
  `type:"conversation"` to invitees. (Note: the client only calls this when the first
  message of a Staff-view DM draft is actually sent — see Messaging feature.)
- `GET /api/conversations/:id/messages` — list messages (member-only) and mark the
  thread read for the caller.
- `POST /api/conversations/:id/messages` — send a message; emits SSE
  `type:"message"` to all members for live delivery + unread badges.
- `POST /api/conversations/:id/ring` — "ring" a conversation (member-only): emits
  an ephemeral SSE `type:"ring"` to every **other** member (caller name + conv
  info). No stored message — just a live nudge. Returns `{ok, notified}`. (Kept as a
  low-level helper; the UI now uses the call endpoints below.)
- `POST /api/conversations/:id/call/join` / `.../call/leave` — join / leave the live
  **WebRTC call** for a conversation (member-only, hospital-scoped). Join adds the
  caller to the in-memory `callRooms` roster, tells everyone already in the call via
  SSE `type:"call-join"` (they offer to the newcomer), rings anyone not yet in the
  call (SSE `type:"ring"` with `is_call:true`), and returns the current
  `{participants}`. Leave broadcasts SSE `type:"call-leave"`. Roster membership is
  also dropped when the user's **last SSE connection** closes (closed tab = leaves).
- `POST /api/conversations/:id/call/signal` — relay one WebRTC signaling message
  (`{to, signal}` — offer / answer / ICE) to another member via SSE
  `type:"call-signal"`. The server never inspects `signal`; `to` must be a member.
- `POST /api/conversations/:id/members` — add people to a **group** (owner or admin
  only). Validates ids to the active department like create; emits `type:"conversation"`
  to all members so lists/open manage-modal refresh live.
- `DELETE /api/conversations/:id/members/:uid` — remove (kick) a group member
  (**owner only**; the owner can't be removed). Broadcasts to remaining members + the
  removed user.
- `PATCH /api/conversations/:id/members/:uid` — set a group member's `role` to `admin`
  or `member` (**owner only**; the owner's role is immutable and the owner can't
  change their own). Broadcasts to members.

**Reports & insights**
- `POST /api/reports` — create (`category`, `description`, `location`, `priority`,
  optional `feeling`, optional `department` — validated against `DEPARTMENTS`, nulled
  if off-list; optional `timeframe` — validated against `TIMEFRAMES`, defaults to
  `Flexible`, and **always forced to `ASAP` when priority is Emergency**). `due_at` is
  computed from `TIMEFRAME_HOURS` (NULL for Flexible). Stamped with the reporter's
  active hospital and **auto-allocated** via `pickAssignee()` (see Availability), or
  left Open. Emergency broadcasts via SSE. Returns the row joined to the assignee.
- `GET /api/reports` — list, joined to reporter + assignee, **scoped to the active
  hospital**. Query params: `status`/`priority`/`category` filters; `sort=urgency`;
  `bucket=resolved` (resolved 2+ min ago), `bucket=allocated` (has assignee),
  `bucket=open` (no assignee). Default: newest-first, emergencies pinned, long-resolved
  hidden.
- `PATCH /api/reports/:id` — update status/priority/acknowledgement/outcome/assigned_to.
  Hospital-scoped (404 otherwise). `assigned_to` accepts only the caller's own id
  (claim/take-over) or `null` (release). Resolving stamps `resolved_at`. Any status
  change broadcasts `type:"reports-changed"` so lists refresh and the reporter's
  feedback check re-runs.
- `GET`/`POST /api/reports/:id/updates` — list / add a timestamped progress update.
  Hospital-scoped.
- `GET /api/reports/feedback-due` — the single oldest report of the **caller's own**
  that is due a post-resolution feedback ask: Resolved, at least
  `FEEDBACK_DELAY_MINUTES` (5) old, and never asked about. Read-only — asking does
  not consume the one-shot. Returns `{report}` or `{report:null}`.
- `POST /api/reports/:id/feedback/requested` — claim the one-shot at the moment the
  prompt is shown. The UPDATE only fires while `feedback_requested_at IS NULL`, so
  racing tabs can't both ask. Returns `{claimed}`.
- `POST /api/reports/:id/feedback` — `{resolved_ok, comment?}`. Reporter-only, and
  only once (`feedback_at IS NULL`); mirrors the answer into the progress log, and
  broadcasts `reports-changed` on a negative answer.
- `POST /api/reports/:id/feedback/next-step` — `{action}` ∈ `reopen` | `support` |
  `related` | `none`, only after feedback exists. `reopen` sets the report back to
  Open and clears `resolved_at`; all three log a progress note.
- `GET /api/insights` — aggregates scoped to the active hospital (totals, counts by
  category/feeling/priority, avg time-to-resolve, acknowledgement rate, updates, and
  `feelingWindows` — feeling counts per rolling timeframe for the emotional-feedback
  stacked bar).
- `GET /api/events` — SSE stream; pushes emergency events, live messages/conversations,
  and lightweight `type:"presence"` nudges (department-scoped) emitted whenever a user
  connects, disconnects or switches department, so colleagues' staff rosters refresh
  their online/offline dots live instead of showing a stale snapshot.
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
- **Continuous re-allocation**: `sweepUnallocatedReports(hospId)` re-runs
  `pickAssignee()` over every still-Open (unallocated) report in a hospital and claims
  any it can now place. It fires whenever free capacity appears — a user toggling to
  `free` (`PATCH /api/availability`), adding/removing an availability window — and on a
  25s `setInterval` safety net. A `sweeping` re-entrancy guard prevents overlap; each
  newly-allocated batch `broadcast`s `{type:"reports-changed"}` (hospital-scoped) so
  clients live-refresh the on-screen report list. (Safe because deploy is Reserved VM,
  single instance — see the Autoscale invariant.)

### Places, floor plans and the issue map

- `GET /api/layout[?hospital_id=]` — the whole location tree plus the room-type
  catalogue and a `can_edit` flag for the viewer. Defaults to the active hospital.
- `POST /api/room-types` — add a custom room type for a hospital.
- `POST /api/locations`, `PATCH /api/locations/:id`, `DELETE /api/locations/:id` —
  editing the hierarchy and the grid geometry. All gated on IT-and-above for the
  hospital in question (admins anywhere).
- `GET /api/heatmap?floor_id=…` — per-room aggregates for one floor, filterable by
  priority / category / status / department / room type / assignee / date range /
  minimum volume / maximum average fix time. Returns **summaries only**.
- `GET /api/locations/:id/reports` — hospital-scoped drill-through to the actual
  tickets for one room. The map itself never carries ticket detail.

## Features (summary)

Read the source for detail; these are the behaviours worth knowing exist.

- **Multi-step report wizard**: guided steps — Describe (voice + text + category
  grid), Where (location + urgency + optional completion timeframe), Feel (shown only
  when priority is not Low). Low issues submit from step 2; Emergency needs a two-step
  confirm.
- **Completion timeframe**: an optional chip row on the Where step lets the reporter
  say how soon it needs doing (ASAP → Flexible). Never required — defaults to
  `Flexible` (no deadline). Choosing Emergency locks it to `ASAP` (chips disabled, not
  asked). Auto-fill can infer it from the description (skipped when Emergency or the
  reporter picked one). Report cards show a clock pill for any real deadline and flag
  it **overdue** once `due_at` passes and it isn't Resolved.
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
  auto-allocate to a free colleague (Open if none) and **keep retrying** — a periodic
  sweep plus availability-change triggers hand any still-Open report to the next
  colleague who becomes free, pushing the change to clients live over SSE. Allocated
  view is grouped per assignee (mine first). Claim / Release / Take-over per card
  (server enforces self-only assignment).
- **Attribution, feeling & acknowledgement**: every report/update/ack carries the
  staff member's real name; an optional feeling chip (negative *and* positive
  options, so staff can flag what went well too); reviewers can acknowledge +
  respond, closing the "was my concern seen?" loop.
- **Closing-the-loop feedback**: once a report is resolved, the reporter is asked
  once — and only once — whether it was actually sorted and whether the process went
  well ("Yes, it went well" / "No, I still need help", plus an optional comment). The
  ask is a non-modal bottom-right card (`#feedbackPrompt`), never a blocking modal.
  Four conditions must hold: resolved, ≥5 minutes since it was raised, never asked
  before, and the reporter isn't filing another report. The first three are enforced
  server-side by `/api/reports/feedback-due`; the fourth is client-side, since only
  the browser knows. A report still unresolved at five minutes simply waits.
  A "no" answer opens next steps — reopen the report, request follow-up support, or
  raise a related report (compose view pre-filled from the original). Answers show
  back on the report card (`.feedback-tag`) and in the progress log, so staff see
  whether their fix landed.
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
  - **Message-a-colleague from Staff**: each staff card has a message button that
    jumps to Messages and opens the existing 1:1 (if any) or a **temporary draft**
    (`draftConv`, no DB row) — the conversation is only created (POST
    `/api/conversations`) when the first message is actually sent. Navigating away
    (back button / view switch / opening another thread) discards an unsent draft.
  - **Group management**: a manage-members control on group threads opens a modal.
    Members are shown with role tags; the **owner** (creator) can promote/demote
    members (admin ⇄ member) and remove them; the owner **and** admins can add people.
    Roles live in `conversation_members.role` (`owner`/`admin`/`member`); the client
    mirror is display-only — the server enforces every guard (owner-only kick/role,
    owner immutable, add is owner/admin). The open modal live-refreshes on the SSE
    `type:"conversation"` nudge the membership endpoints broadcast.
  - **Calls (live video/audio)**: a call button on any open thread (DM or group)
    starts a live **WebRTC call**. Recipients get an incoming-call banner (caller
    name + Join / Decline, alert tone, 30s auto-dismiss); Join answers with their
    camera + mic. It's a full **mesh** — each participant peers with every other and
    streams peer-to-peer; the server only relays signaling over SSE (`call-join` /
    `call-signal` / `call-leave`). The caller grabs `getUserMedia` (video+audio,
    **falling back to audio-only** if there's no camera / it's denied), opens a
    full-screen call overlay (video-tile grid + mute / camera / hang-up controls),
    then POSTs `call/join`. **Glare rule**: whoever is *already* in the call offers
    to each newcomer, so each pair negotiates once. STUN-only (public Google STUN),
    no TURN — fine on typical networks, may fail behind strict/symmetric NAT. No size
    cap. Drafts can't be called (no server row yet). Media needs mic/camera
    permission and a real browser tab (blocked in the embedded preview iframe, like
    voice input).
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
- **Configurable floor plans**: every hospital gets a starter layout seeded on first
  boot (idempotent — a hospital is seeded only when it has *zero* locations, so IT
  edits survive restarts). The "Floor plans" view pairs a structure tree (buildings /
  wings / floors / departments) with a snap-to-grid designer for the rooms and
  corridors on the selected floor. Blocks drag to move; with a block focused, arrow
  keys nudge it and Shift + arrows resize it. There are no floor-plan images.
- **Issue map**: the "Issue map" view shades each room by its worst open priority and
  darkens it by report volume, with filters (priority, category, status, department,
  room type, assignee, date range, minimum volume, maximum average fix time).
  Neighbouring rooms that all have reports collapse into a single hotspot marker.
  Selecting a room drills through to its actual tickets. It redraws live from the
  `reports-changed` and `layout-changed` SSE events.
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

- **The feedback ask is one-shot and must never be burnt silently**: showing the
  prompt latches `feedback_requested_at`, so once claimed it can never be re-fetched.
  The client therefore only claims when it can actually show the card, and if the
  reporter starts composing while it's up, `deferFeedbackIfComposing()` holds it in
  the in-memory `feedbackPending` slot rather than discarding it. Any new "don't
  show right now" condition must defer, not drop.
- **A location's kind must sit deeper than its parent's**: `locations` is one
  self-referencing table, so nothing but `validateParentage()` in `server.js` stops a
  building being filed inside a room. The rule is *strictly later in
  `LOCATION_KINDS`*, which lets levels be **skipped** (not every site has wings) but
  never inverted. `LOCATION_KINDS` is mirrored in `public/app.js` — edit both.
- **Never cascade-delete a place that has tickets**: `DELETE /api/locations/:id`
  answers **409 with `can_deactivate: true`** when reports point at it, and the client
  offers deactivation instead. History must not lose where something happened.
  `reports.location_id` is `ON DELETE SET NULL` as a second line of defence.
- **The map must read without colour**: shading is only ever a supplement. Every room
  block also prints its exact count and a priority letter, overdue rooms get a stripe
  pattern plus a ⚑, and hotspots get a dashed ring. Don't add a state that is
  signalled by hue alone.
- **A floor is drawn as a plan, not as a grid of tiles**: `.floorgrid` has no gap, so
  neighbouring blocks' borders *are* the shared walls, and `--fg-cell` is written from
  JS (`applyFloorZoom`, fit-to-width by default) so cells stay **square** at any zoom —
  the column track is sized in pixels, never `1fr`. Anything that reads cell geometry
  (`gridMetrics` for dragging) must read `--fg-cell` rather than dividing the pane
  width. Doors are derived from neighbours by `doorSideFor()`, never stored, and they
  sit *on* the wall — which is why `.fgblock` must not be `overflow: hidden`
  (`.fgblock-body` does the label clipping instead). The external wall is a separate
  `.fgshell` item spanning the bounding box of what is placed, so a half-built floor
  looks like a building on a sheet rather than one enormous room — and that same box
  bounds the door search, so nothing opens through the outer wall.
- **Saving a block re-renders the whole plan, so focus has to be put back**: the
  designer's arrow-key nudge patches the server, which reloads and rebuilds every
  block element. `renderDesignGrid()` therefore restores focus to the selected block
  when focus was inside the grid before the rebuild. Without it the first arrow press
  works, focus falls to `<body>`, and every press after that does nothing — the
  keyboard path dies silently while the mouse path looks fine.
- **The insights rail is hospital-wide and ignores every view's filters**: it is
  therefore hidden on the views that own the right-hand column and show their own,
  differently-scoped numbers (Insights, Issue map, Floor plans). Side by side they
  read as contradictory — a filtered map showing 0 next to a rail showing 1.
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
- **Conversation roles are server-enforced**: group permissions live in
  `conversation_members.role` (`owner`/`admin`/`member`, creator = owner). The
  membership endpoints enforce every guard server-side (owner-only kick + role change,
  the owner is immutable and can't demote themselves, add is owner-or-admin, group-only,
  active-hospital scoped). The client's `my_role`/role checks only show/hide controls —
  never trust them. The membership endpoints each `broadcast` a `type:"conversation"`
  nudge to all members (plus a kicked user) so lists and any open manage-modal refresh
  live.
- **Effective-free precedence**: a `busy` window covering "now" always beats a `free`
  window and the manual `availability_status`; with no covering window the manual
  status applies (default `free`). Keep this ordering in `effectiveFreeUserIds()`.
- **Nav view registry sync**: every new view needs a `data-view` element in **both**
  the sidebar rail and the mobile bottom nav / More sheet, and (if secondary) an
  entry in `MORE_VIEWS`, or the view is unreachable on one form factor.
- **Allowlist sync**: `CATEGORIES`, `FEELINGS`, `CATEGORY_PROFESSIONS`, `DEPARTMENTS`
  and `TIMEFRAMES` live in **both** `app.js` and `server.js`. Edit them together or
  new-category reports are rejected, feelings silently dropped, profession-based
  allocation misfires, a designated department is silently nulled, or a timeframe is
  silently reset to `Flexible` server-side. `TIMEFRAME_HOURS` (timeframe → hours for
  `due_at`) is server-only; keep its keys in sync with `TIMEFRAMES`.
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
  home hospital, or switched-in colleagues vanish. The roster itself is only a
  **snapshot** taken at fetch time, so connect/disconnect/switch must `broadcast` a
  department-scoped `type:"presence"` event; the client re-fetches the on-screen
  roster (staff/hospitals) on it. Without that nudge others keep seeing a colleague
  as offline until a manual refresh.
- **Re-tag SSE on department switch**: a live `/api/events` connection's
  userId/hospitalId tag goes stale when a user switches department mid-session, so the
  switch endpoint re-tags all that user's SSE clients (else old-hospital emergencies
  leak). Any per-connection tag that can change must be refreshed the same way.
- **Emergency is never auto-set**: `detectPriority` and the AI assist cap at High.
  Emergency stays a manual, two-step-confirmed choice so free text can't broadcast.
- **Emergency is always ASAP**: whenever a report's priority becomes `Emergency` — on
  create **and** via `PATCH /api/reports/:id` — the server forces `timeframe='ASAP'`
  and stamps `due_at=NOW()`, ignoring any client-sent timeframe. Enforce it on every
  path that can set priority, or an escalation leaves a stale non-ASAP deadline.
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
