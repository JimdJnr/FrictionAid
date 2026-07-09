# Friction Aid — Quick Issue Reporting for Healthcare Staff

A fast, mobile-friendly tool for ward/clinical staff to report everyday friction —
missing linen, hunting for equipment, slow computers, waiting on porters, etc. —
in seconds. Staff **sign in with an email + password account** (first name, last
name, profession), then **dictate** the issue with voice-to-text or type it, pick
a common category, add a location and priority, and submit. Reports are attributed
to the signed-in staff member's real name and can be reviewed and triaged
(Open / In progress / Resolved).

## Architecture

- **Frontend** (`public/`): a vanilla-JS single-page app gated behind a
  sign-in / register screen, laid out in an **Outlook-style shell** — a slim blue
  app bar (`.ol-appbar`: waffle menu, app name, centered quick-search
  `#globalSearch`, settings gear, round initials avatar), a left **folder rail**
  sidebar (`.ol-sidebar`: "New report" compose button + report views) and a
  scrolling content pane (`.container`). A full-height flex column means only the
  content pane scrolls (mail-client feel). On phones (≤560px) the sidebar hides
  and views move to a fixed **bottom navigation bar** with five items — Reports
  (`list`), Allocated (`all`), Open (`open`), Insights and **More** (`#moreBtn`, no
  `data-view`; opens the `#moreSheet` bottom sheet with My schedule / Resolved /
  Hospitals / Staff online / Settings). Compose moves to a floating **`#composeFab`** (data-view `report`,
  revealed in `showApp`). All nav elements (`.ol-nav-item`, `.ol-compose`,
  `.bottomnav-btn`, `.moresheet-item`, `.compose-fab`) carry `data-view` and stay
  in sync via a single `activateView()` (which also toggles the More button's
  active state and closes the sheet). Quick-search filters visible cards
  (`applySearchFilter`, re-applied on async re-renders via a `MutationObserver`).
  Palette/typography follow Outlook (blue `#0f6cbd`, Segoe UI).
- **Backend** (`server.js`): an Express server serving the static frontend and a
  small JSON API. Auth uses **email + password accounts** with server-side
  sessions (`express-session` + `connect-pg-simple`, backed by a PostgreSQL
  `session` table). Passwords are hashed with scrypt (salt stored alongside the
  hash). Requires a `SESSION_SECRET` env var (kept as a Replit secret).
  `express.json` uses a 2 MB limit to allow avatar data URLs.
- **Database**: Replit-managed **PostgreSQL** (`users`, `reports`,
  `report_updates`, `hospitals`, `session` tables).

## Data model

- **`hospitals`**: id, name (unique), password (plaintext, demo only), created_at.
  Seeded from `HOSPITAL_SEED` on boot (INSERT … ON CONFLICT DO NOTHING).
- **`users`**: id, email (unique), password_hash (scrypt), first_name, last_name,
  profession, alias (optional display name), avatar (optional data-URL image),
  hospital_id (FK → hospitals; home hospital), theme_color, font_scale, dark_mode,
  voice_autostart (per-user personalisation, with defaults),
  availability_status (`free`/`busy`, default `free`; the manual free/busy toggle),
  created_at.
- **`reports`**: id, category, description, location, priority
  (Low/Medium/High/Emergency), user_id (FK → users; reporting account), hospital_id
  (FK → hospitals; the department the report belongs to — set from the reporter's
  active hospital on create, backfilled from home hospital for old rows), status
  (Open/In progress/Resolved), feeling (optional reporter emotion), acknowledged_at,
  acknowledged_by, response_note, outcome ("what was done" note),
  assigned_to (FK → users; the staff member the report was auto-allocated to, or
  NULL = unallocated "Open"), assigned_at, created_at,
  resolved_at. Legacy columns `reporter` / `identity_mode` remain for old rows but
  are no longer written.
- **`availability`**: id, user_id (FK → users, ON DELETE CASCADE), status
  (`free`/`busy`), starts_at (nullable), ends_at (nullable), note, created_at. One
  row per scheduled free/busy window; a window with `starts_at`/`ends_at` covering
  "now" overrides the user's `availability_status`.
- **`report_updates`**: id, report_id (FK → reports, ON DELETE CASCADE), note,
  author, created_at. One row per progress update; `GET /api/reports` returns an
  `update_count` per report via a correlated subquery.

## API

All report/insight/event endpoints require a signed-in user (`requireAuth`
middleware, which loads the account into `req.user`). Reports, progress updates,
and acknowledgements are attributed to the signed-in user's real name — the client
cannot supply an arbitrary name.

### Auth & account

- `POST /api/register` — create an account (`email`, `password` [≥6 chars],
  `first_name`, `last_name`, `profession`) and sign in. 409 on duplicate email
  (also caught via PG unique-violation `23505`).
- `POST /api/login` — sign in (`email`, `password`); 401 on bad credentials.
- `POST /api/logout` — destroy the session and clear the `connect.sid` cookie.
- `GET /api/me` — the current account (401 if not signed in); used on load to
  choose between the app and the sign-in screen. Payload includes profile (name,
  alias, profession, avatar), personalisation (`theme_color`, `font_scale`,
  `dark_mode`, `voice_autostart`) and home/active hospital.
- `PATCH /api/me` — update the account. Every field is optional; only supplied,
  valid fields change: `first_name` / `last_name` / `profession` (non-empty,
  length-capped), `alias` (≤80 or null), `avatar` (`data:image/*;base64,…` ≤~1 MB,
  or null to clear), `theme_color` (in `THEME_COLORS`), `font_scale`
  (small/medium/large), `dark_mode` (bool), `voice_autostart` (bool).

### Hospitals & presence

- `GET /api/hospitals` — every hospital with its staff (name, role, avatar, live
  `online` flag), its plaintext `password` (demo only), and `is_home` / `is_active`
  flags.
- `POST /api/hospitals/:id/switch` — switch the active department; requires the
  destination hospital's `password`. Stores the choice in `session.activeHospitalId`.
- `GET /api/staff` — everyone currently signed in **in the viewer's active
  department**, from **live SSE presence** (`onlineUserIdsInHospital()`, derived
  from open `/api/events` streams — not a separate in-memory list), each with name,
  role, avatar, hospital, and an `is_me` flag. Colleagues who *switched into* the
  department are included (the query does not filter on home hospital).

### Reports & insights

- `POST /api/reports` — create a report (`category`, `description`, `location`,
  `priority`, optional `feeling`). Attributed via `user_id` and stamped with the
  reporter's **active hospital** (`hospital_id`). **Auto-allocated** on create via
  `pickAssignee()` (see Availability): sets `assigned_to`/`assigned_at` to a
  currently-free colleague, or leaves them NULL ("Open") if nobody is free.
  Broadcasts an emergency event if `priority` is `Emergency`. `feeling` validated
  against the `FEELINGS` allowlist. The report row is returned joined to the
  assignee (`assignee_first_name`/`last_name`/`profession`/`avatar`).
- `GET /api/reports` — list reports (joined to `users` for reporter name/
  profession **and** to the assignee), **scoped to the viewer's active hospital**
  (empty list if not part of a hospital). Query params: `status` / `priority` /
  `category` (validated filters); `sort=urgency` (Emergency > High > Medium > Low,
  then newest — "Allocated reports"); `bucket=resolved` (only reports resolved 2+
  minutes ago); `bucket=allocated` (`assigned_to` NOT NULL); `bucket=open`
  (`assigned_to` IS NULL — nobody was free). Default is newest-first with
  emergencies pinned to top and long-resolved reports hidden.
- `PATCH /api/reports/:id` — update `status`, `priority`, acknowledgement,
  `outcome`, and/or `assigned_to`. **Hospital-scoped** (404 otherwise). `assigned_to`
  accepts either the **caller's own id** (self-claim / take-over an Open or
  someone-else's report) or `null` (release back to Open); it cannot be used to
  assign an arbitrary third party. Resolving sets `resolved_at`; any non-resolved
  status clears it. Escalating to `Emergency` broadcasts. `acknowledged` (strict
  bool): `true` stamps `acknowledged_at` + `acknowledged_by` (always the reviewer's
  name) plus optional `response_note`; `false` clears all three.
- `GET` / `POST /api/reports/:id/updates` — list (oldest first) / add a timestamped
  progress update (`note` required; `author` always the signed-in user).
  Hospital-scoped (404 unless the report is in the viewer's hospital).
- `GET /api/insights` — aggregates for organisational learning, **scoped to the
  viewer's active hospital**: totals (open/in-progress/resolved/emergencies/
  acknowledged), counts by category/feeling/priority, average time-to-resolve
  (minutes), acknowledgement rate, total progress updates.
- `GET /api/events` — Server-Sent Events stream; pushes `{type:"emergency"}` to
  connected clients for real-time notifications.
- `POST /api/assist` — AI conversational helper for "Talk it through". Takes
  `{description, messages, fields}` and returns `{reply, extracted, complete}`.
  Uses OpenAI via **Replit AI Integrations** (keyless — `getOpenAIClient()` reads
  `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY`; 503 if
  unset). Extracts `category` / `location` / `priority` / `feeling`, re-validated
  server-side, and **never** sets Emergency (capped at High).

### Availability & auto-allocation

- `GET /api/availability` — the caller's `{status, windows}` (their manual
  free/busy flag plus their scheduled free/busy windows).
- `PATCH /api/availability` — set the caller's manual `status` (`free`/`busy`).
- `POST /api/availability/windows` — add a scheduled window (`status` +
  `starts_at` and/or `ends_at`, optional `note`). A window needs at least one of
  start/end; if both, end must be after start.
- `DELETE /api/availability/windows/:id` — remove one of the caller's own windows.
- `GET /api/availability/team` — everyone in the viewer's active hospital with
  their **effective** free/busy (`free` bool), live SSE `online` flag, and `is_me`.

**Allocation logic** (`server.js`): `effectiveFreeUserIds(userRows)` computes who
is free right now — a busy window covering "now" wins over a free window, and with
no covering window the user's `availability_status` applies (default `free`).
`pickAssignee(hospitalId, reporterId)` chooses among the effective-free users in
that hospital, **preferring** a non-reporter, then someone online (live SSE),
then whoever has the fewest active (non-resolved) assignments; returns NULL if
nobody is free (→ Open).

## Features

### Multi-step report wizard

The New Report view (`#reportView`) is a guided **wizard** (`.wizard` /
`.wizard-step` in `index.html`; controller in `app.js`) with a `.wizard-progress`
stepper:

- **Step 1 — Describe the issue**: voice (`#voiceBtn`) + `#description`, the "Talk
  it through" assist card, and the category grid (auto-suggested). "Next: Location"
  (`#toLocationBtn`) is disabled until the description has text.
- **Step 2 — Where is it?**: `#location` with its **own** voice button
  (`#locVoiceBtn`) plus the urgency `#priorityGroup`.
- **Step 3 — How did this make you feel?**: feeling chips, shown **only when the
  effective priority is Medium/High/Emergency** (`feelingApplies()` →
  `selectedPriority !== "Low"`). For a **Low** issue, step 2's primary button
  relabels to "Submit report" and the report submits from step 2 (step 3 marked
  `.skip`). Emergency still requires the manual two-step confirm.

`goToStep(n)` toggles the `.active` step. `setPriority()` calls
`updateWizardProgress()` so the branch/label stay in sync. Submit is factored into
`submitReport()` (shared by `#submitBtn` and the Low-priority step-2 button);
`resetForm()` returns to step 1. Each active step's children animate in with a
staggered rise, and the current stepper dot pops.

**Voice is target-aware**: one `SpeechRecognition` engine is pointed at the
description, location, or **feeling** (step 3's `#feelVoiceBtn`) via `VOICE_TARGETS`
/ `startVoice(target)` / `toggleVoice(target)`. Spoken location sets
`manualLocation = true`; spoken feeling runs `detectFeeling` on the transcript and,
on a match, sets `selectedFeeling` + `manualFeeling`. Autostart voice defaults to
the description field.

**Mobile hands-free flow**: on phones (`isMobileView()` = `matchMedia("(max-width:
560px)")`), dictating the description on step 1 begins a hands-free chain
(`voiceFlow`). After the 3s silence-timer stops listening, `advanceVoiceFlow(target)`
routes to the next *unfilled* step: if `#location` is empty it goes to step 2 and
auto-starts location voice; else if `feelingApplies()` and no feeling is set it goes
to step 3 and auto-starts feeling voice; else it calls `submitReport()`. Each step is
prompted at most **once** (`voiceFlowPrompted`) so a silent reporter is never trapped
in a loop. On each jump `promptVoiceStep` shows the cue in the field's voice status
**and speaks it aloud** (`speakPrompt` → Web Speech `speechSynthesis`), starting the
mic only **after** the spoken prompt ends so the mic doesn't transcribe the prompt;
`speakPrompt` always fires its callback exactly once (utterance `onend`/`onerror` +
a timeout fallback) so missing/instant TTS can never stall the chain. Any manual wizard navigation (Next/Back taps) or the feeling mic button
calls `resetVoiceFlow()` to hand control back. The chain only runs on mobile and only
when started from the description; desktop and manual location/feeling mic taps behave
as before. Emergency is still never auto-set, so auto-submit can't fire a broadcast.

While the chain is driving, a persistent **voice-coach bar** (`#voiceCoach`, with
animated `.vc-eq` equaliser bars, a live status line and a **Stop** button) shows
what's happening — "Listening — describe the issue", "Now: where is it?", "All set —
filing your report…" — via `showVoiceCoach` / `updateVoiceCoach` (listening vs paused)
and is cleared by `hideVoiceCoach` from `resetVoiceFlow` (so every exit path hides it);
its Stop button hands control back (`resetVoiceFlow` + `stopVoice`). Because a report
filed without a tap is otherwise confusing, `submitReport(auto)` takes a flag and the
**auto path announces itself**: a prominent amber `toast-auto` toast ("Report sent
automatically" + the spelled-out reference) in `#toastHost` that is also spoken aloud.
Manual submits pass `submitReport(false)` (the button binding must not let a MouseEvent
be read as a truthy `auto`) and show a green `toast-success`; failures show an error
toast. Toasts are rendered by `showToast({variant,title,sub,duration})`.

**Healthcare speech correction**: final transcript chunks are passed through
`correctHealthcareSpeech(text)` (in `app.js`) before being appended, so common
ward-vocabulary mishearings are fixed (e.g. "war" → "ward", "a and e" → "A&E",
Resus, theatre, HDU/ITU/ICU, cannula, commode, obs). Rules live in the
`HEALTH_SPEECH_FIXES` list — each `[pattern, replacement]` uses `\b` word
boundaries + the `i` flag, with the replacement carrying the correct clinical
casing. Applied **only** to `isFinal` chunks so it never fights the live interim
text; extend the list with any newly-reported mishearing.

**Spoken self-corrections**: on the location/feeling fields (not the free-text
description), a final chunk opening with a correction marker — "no I meant …",
"actually …", "sorry I meant …", "correction …" (`CORRECTION_MARKERS` /
`extractCorrection`) — **replaces** the field's value with just the corrected
remainder instead of appending to the mistake (so a re-prompted "no I meant ward 6"
overwrites "ward 5"). The description is excluded because such phrasing there is
usually mid-sentence and must not wipe what was already dictated.

### Smart capture (auto-fill from the description)

The "Describe it" text (typed or dictated) is parsed to pre-fill the rest of the
form. All parsing lives in `app.js`:

- **Detects**: category (`autoCategorize`), priority (`detectPriority` — urgent →
  High, low-priority language → Low), feeling (`detectFeeling` against
  `FEELING_KEYWORDS`), and location/ward (`detectLocation` — "ward/bay/bed/room/
  floor/level…" + numbers, ordinal floors, named areas like "Resus", "A&E").
- **Never overrides manual choices**: `maybeAutoFill` only writes to untouched
  fields, tracked by `manualPriority` / `manualFeeling` / `manualLocation`
  (programmatic `.value` writes don't fire `input`, so they don't trip these).
  Flags reset in `resetForm`. An `#autofillNote` reports what was set.
- **Robustness**: priority matching checks the Low list first, uses word-boundary
  matching (so "urgent" doesn't fire in "insurgent") and strips negated urgency
  ("not an emergency") before scanning the High list.

### Talk it through (AI conversational assistant)

Once a description exists, "Help me finish this report" (`#assistStart` →
`#assistMessages` / `#assistInputRow`) opens a chat: the assistant (via
`POST /api/assist`) asks one short follow-up at a time and auto-fills using the
same setters as smart capture (`applyCategory`, `setPriority`, `highlightFeeling`,
location) plus the matching `manual*` flags. On `complete:true` the chat closes and
the pre-filled form is ready. Degrades gracefully (503 / errors → friendly
"fill it manually" message).

### Report lifecycle & notifications

- **Emergency**: staff can create or escalate to Emergency. Emergencies pin to the
  top of "Recent reports" and, via SSE, flash a banner + alert tone in every open
  browser (`broadcast()` shows the reporter's first name).
- **Two-step confirmation for emergency actions**: emergency-sensitive actions
  need a confirming second click — selecting Emergency priority, the per-card "🚨
  Mark emergency" button ("Click again to confirm"), resolving an emergency report
  (inline "Confirm resolve / Cancel" strip), and unresolving one. Non-emergency
  resolve/unresolve stay single-click.
- **Resolved reports**: a resolved report stays in active lists for 2 minutes
  (`RESOLVE_DELAY_MINUTES`) then moves to the "Resolved reports" tab, from where it
  can be unresolved.

### Availability, schedule & auto-allocation

Every new report is **auto-allocated to a currently-free colleague** so issues land
with a named owner instead of a shared inbox.

- **My schedule** (`#scheduleView`, in the More sheet / Availability sidebar
  group): a manual **I'm free / I'm busy** toggle (`PATCH /api/availability`), a
  **voice** control that parses spoken availability, an **upcoming windows** list
  with a manual add form (status + date + from/to), and a live **"Who's free now"**
  team roster (`GET /api/availability/team`).
- **Voice availability** (`toggleScheduleVoice`, its own `SpeechRecognition`
  instance separate from the wizard): `parseScheduleSpeech(text)` understands
  phrases like "I'm free", "busy until 3pm", "free from 2 to 5", and "free
  tomorrow 9 to 5" — returning either a `status` change or a timed `window`
  (`parseTimeToken` / `dayBaseFrom` resolve clock times and today/tomorrow).
- **Allocated vs Open**: "All reports" is renamed **Allocated reports** (`GET
  /api/reports?bucket=allocated`) — reports with an assignee. When nobody was free
  at file time the report goes to **Open reports** (`bucket=open`, `assigned_to IS
  NULL`) for anyone to pick up.
- **Claim / Release / Take over**: each card shows who it's allocated to (an
  assign pill + line). A **Claim** button (on Open or someone-else's report) sets
  `assigned_to` to the caller; a **Release** button (on your own) clears it back to
  Open. The server only lets a caller assign a report to **themselves** or `null`.

### Attribution, feeling & acknowledgement

- **Attribution**: every report, update, and acknowledgement carries the staff
  member's real name. `reporterByline()` shows "by First Last · Profession" from
  the joined `users` row (falling back to legacy `reporter`, then "Staff").
- **Feeling (optional)**: the reporter can tap one chip (Frustrated / Embarrassed /
  Resentful / Undervalued / Helpless / Cynical) or leave it blank; tapping the
  selected chip clears it. Shows as a tag on the card.
- **Acknowledge / respond**: a reviewer can acknowledge a report and add a short
  response (reviewer name taken from their account). Acknowledged reports show a
  green "✓ Acknowledged" pill with who/when; acknowledgement can be cleared. Closes
  the "was my concern seen?" loop.

### Closing the "black box" gap

Five features make the process transparent end-to-end:

- **Instant reference number**: on submit the reporter gets a human-friendly
  reference (`WR-0001`, from the report id), also shown on every card.
- **Transparent escalation routes**: each issue type maps to an owning team (the
  `ROUTES` map in `app.js`). The form shows "This goes to: …" and each card shows a
  "Routes to …" tag (display-only; `ROUTES` keys must match `CATEGORIES`).
- **Progress update log**: each report has an expandable, timestamped update log;
  the card shows the count and lazy-loads the log on first open.
- **Visible outcomes**: resolving opens an inline form to capture an optional
  `outcome`; resolved cards also have "Add/Edit outcome". Shows in a green block.
- **Insights & learning**: an "Insights" tab summarises volumes, feelings, priority
  mix, average time-to-resolve, acknowledgement rate, and total updates.

### Hospitals & staff presence

Two "Organisation" views. Hospital scoping is centralised in `activeHospitalId(req)`
(session active department → user home hospital → null); a null result hides
reports and staff entirely.

- **Hospitals** (`#hospitalsView` → `GET /api/hospitals`): lists every hospital
  with a "Your hospital" / "Active department" badge and a staff count. The staff
  **roster is only revealed for the viewer's own (active) department**; other
  hospitals show the count only. Switching requires that hospital's **password**
  (displayed above the field, for the demo).
- **Staff online** (`#staffView` → `GET /api/staff`): everyone signed in right now
  **in the viewer's active department**, from real SSE presence (see the presence
  invariant below). Colleagues who switched *into* the department are included.

### Profile & settings

The header gear (`#settingsBtn`) opens a **Profile** view (`#profileView`, toggled
via `activateView("profile")`).

- **Edit details**: first/last name, profession, optional alias, and a profile
  picture (read client-side as a data URL ≤~1 MB, saved via `PATCH /api/me`; header
  chip updates immediately).
- **Appearance**: a theme-colour swatch picker (`THEME_COLORS`), a font-size
  segmented control (`FONT_SCALES`), and a dark-mode toggle. All persist per-user
  and apply instantly via `applyPreferences()` (sets `--brand` / `--base-font` and
  `data-theme="dark|light"` on `<html>`; applied on load in `showApp`).
- **Autostart voice** (`#autostartToggle` → `voice_autostart`): when on,
  `maybeAutostartVoice()` starts speech capture shortly after the app opens
  (no-ops when unsupported / mic blocked).

### Describe-section helpers & prompts

- **Auto-fill hint** (`#descHint`): a persistent banner telling reporters they can
  describe the issue in their own words (and mention ward/urgency/feeling) to
  auto-fill the form — makes smart capture discoverable.
- **Clear button** (`#clearDescBtn`): overlaid top-right of the textarea, shown
  only when it has content; empties the description and re-runs
  `handleDescriptionChange` (clears auto-filled untouched fields, keeps hand-set
  choices), then refocuses.
- **"Please describe it" prompt** (`#descPrompt`): if the reporter engages another
  field or submits while the description is empty, an amber prompt nudges them
  first; hides as soon as they focus/type the description.

## UI/UX

### Reports as expanding "emails"

Each card (`.report-item`) shows a compact **row** (`.report-row`): sender avatar
(picture or initials), category as subject, timestamp, reporter name, a one-line
snippet, and status / priority / acknowledged badges. A hidden **body**
(`.report-body`, a `grid-template-rows: 0fr→1fr` reveal) holds the full
description, routing/feeling tags, outcome block, acknowledgement note, meta and
actions. It expands on `:hover` / `:focus-within` (desktop) and on tap (touch —
toggles `.expanded`). Avatars are painted after insertion via `paintAvatar()`.

### Motion & polish

A light, fast motion layer (all in `style.css`, all disabled under
`prefers-reduced-motion`):

- **View/tab transitions**: a staggered "rise in" fade-up on the shown view's
  children. `animateViewIn()` does remove → forced reflow → re-add of `animate-in`
  so it replays every switch.
- **Wizard steps**: each active step's children stagger in; the current stepper dot
  pops.
- **Report cards**: per-index staggered fade/slide-in; entrance uses
  `animation-fill-mode: backwards` (not `both`) so it doesn't kill the hover lift.
- **Panels & feedback**: inline forms and the emergency confirm strip slide open
  (`expandIn`); status messages pop in (`popIn`); the emergency banner drops in
  (`bannerDrop`) then flashes; Insights stats pop while bars grow from the left.

### Responsive layout (phone · tablet · desktop)

- **Phone (≤560px)**: sidebar hides, navigation drops to a fixed bottom bar; the
  app bar compacts; large circular mic button; full-width 16px inputs (avoids iOS
  zoom).
- **Tablet (561–900px)**: narrower (200px) folder rail; two-column category/insight
  grids.
- **Desktop (>900px)**: full folder rail + content pane; two-column New report grid;
  the waffle toggles the rail (`.ol-sidebar.collapsed`).

### Installable app (PWA)

- **Manifest** (`public/manifest.webmanifest`): name, theme/background `#0d6b7a`,
  `display: standalone`, icons.
- **Icons** (`public/icons/`): `icon-192.png`, `icon-512.png`, full-bleed
  `icon-maskable-512.png` (Android adaptive), `apple-touch-icon.png` (iOS).
- **Service worker** (`public/sw.js`): see the caching invariant below.
- **Meta tags & safe areas**: iOS/Android PWA meta tags, `viewport-fit=cover`, and
  `env(safe-area-inset-*)` padding so nothing sits under a notch / home indicator.
- **Installing**: no in-app button — install via the browser's own control
  (address bar / menu) or, on iOS, Share → Add to Home Screen.

#### Launch modes — two installable PWAs from one page

The same `index.html` can install as **two separate home-screen apps** via a
`?launch=` query param, each with its own manifest and on-open behaviour:

- **Quick Report** (`/?launch=report`, `public/manifest-report.webmanifest`):
  opens the compose view and **starts listening immediately** (forces voice
  autostart regardless of the per-user `voice_autostart` preference).
- **Ward Insights** (`/?launch=insights`, `public/manifest-insights.webmanifest`):
  opens straight to the Insights dashboard (no voice).

An **inline head script in `index.html`** (runs before `app.js`) reads the param,
sets `window.__LAUNCH_MODE`, and swaps `#manifestLink`'s href + the iOS title to
the mode's manifest so the browser's install prompt registers that mode as its own
app. Each manifest carries a distinct `id` / `name` / `start_url` (the `?launch=`
URL) so the two installs don't collide. `showApp()` reads `window.__LAUNCH_MODE`
and branches: `insights` → `activateView("insights")`; `report` →
`activateView("report")` + `maybeAutostartVoice(true)`; otherwise the normal
default view + opt-in autostart. Both manifests are in the SW `APP_SHELL`.

## Invariants & gotchas

These are the non-obvious rules that keep the app working — break one and something
fails silently.

- **`assigned_to` is self-only**: `PATCH /api/reports/:id` accepts `assigned_to`
  only as the **caller's own id** (claim / take-over) or `null` (release). Never
  let it set an arbitrary third party — auto-allocation is the only path that picks
  someone else, and it runs server-side in `pickAssignee()`.
- **Effective-free precedence**: a `busy` window covering "now" always beats a
  `free` window and the manual `availability_status`; with no covering window the
  manual status applies (default `free`). Keep this ordering in
  `effectiveFreeUserIds()` or allocation picks people who are actually busy.
- **Nav view registry sync**: every new view needs a `data-view` element in **both**
  the sidebar rail and the mobile bottom nav / More sheet, and (if secondary) an
  entry in `MORE_VIEWS` in `app.js`, or the view is unreachable on one form factor.

- **Allowlist sync**: `CATEGORIES` and `FEELINGS` live in **both** `app.js` and
  `server.js` (server-side allowlists). Edit both together or new-category reports
  are rejected and feelings silently dropped. `ROUTES` is client-only but its keys
  must match `CATEGORIES`.
- **Hospital scoping / IDOR**: every read/write touching reports must be
  constrained to the viewer's active hospital — including the **by-id** routes
  (`PATCH /api/reports/:id`, both `/updates`), not just the list endpoints.
- **Live SSE presence, no parallel store**: presence is derived directly from open
  `/api/events` streams (`sseClients`, tagged with userId + hospitalId) via
  `onlineUserIdsInHospital()`. Do **not** reintroduce a separate presence map — it
  drifts. Scope staff by active-department presence, not home hospital, or
  switched-in colleagues vanish.
- **Re-tag SSE on department switch**: each `/api/events` connection's
  userId/hospitalId tag goes stale when a user switches department mid-session, so
  the switch endpoint re-tags all that user's live SSE clients (else old-hospital
  emergencies leak). Any per-connection tag that can change must be refreshed the
  same way.
- **Emergency is never auto-set**: `detectPriority` and the AI assist cap at High.
  Emergency stays a manual, two-step-confirmed choice so free text can't fire an
  emergency broadcast.
- **Wizard steps avoid `.hidden !important`**: steps toggle
  `.wizard-step:not(.active){display:none}`, and view switching uses `.hidden`
  (`display: none !important`). The `!important` is required because the desktop
  layout targets `#reportView { display: grid }` by **ID**, whose specificity would
  otherwise beat a plain `.hidden` class (the "new section appears at the bottom"
  bug). The wizard deliberately does **not** reuse `.hidden` to sidestep the same
  clash between steps.
- **Card entrance fill-mode**: entrance keyframes on elements that also
  hover-transform must use `animation-fill-mode: backwards`, not `both`, or the
  hover lift dies.
- **Service worker caching**: `/api/*` (including SSE) is **never** cached (always
  network) so reports/auth/emergencies stay live. Navigations and the code assets
  (`app.js`, `style.css`) are **network-first** with a cached fallback; only
  icons/manifest are cache-first. **Bump the `CACHE` version in `sw.js` whenever
  shell assets change** — the SW uses `skipWaiting()` + `clients.claim()` and the
  registration reloads the tab once on `controllerchange`, so a fresh build
  replaces a stale one automatically. Skipping the bump leaves standalone tabs
  running stale `app.js`/`style.css` after a deploy.
- **Reserved VM only, not Autoscale**: presence and emergency SSE rely on in-memory
  `sseClients`. Autoscale runs multiple instances (separate memory), so users on
  different instances wouldn't see each other online or receive each other's
  alerts. Keep `.replit` `deploymentTarget = "vm"`.
- **Passwords in plaintext (demo)**: hospital passwords are stored and returned in
  plaintext for the demo — hash them before any real deployment.
- **Voice needs Chromium in its own tab**: Web Speech API needs Chrome/Edge/Brave
  in a real tab (mic is blocked in embedded preview iframes); on Windows, Edge
  needs "Online speech recognition" enabled. Typing always works as a fallback.

## Project layout

- `server.js` — Express server + REST API (port 5000).
- `public/index.html` — app markup; registers the service worker and carries PWA
  meta tags.
- `public/app.js` — categories, feelings, routes, wizard controller, voice input,
  smart capture, report list, progress updates, insights.
- `public/style.css` — styling and the motion layer.
- `public/sw.js` — service worker (never caches `/api/*`).
- `public/manifest.webmanifest` — PWA manifest.
- `public/icons/` — PWA / home-screen icons.

## Running & deployment

- **Running**: the "Start application" workflow runs `npm start` (`node server.js`)
  on port 5000.
- **Deployment**: **Reserved VM** (`npm start`) backed by the managed PostgreSQL
  database. A VM (single always-on instance) is required — see the "Reserved VM
  only" invariant above.

## User preferences

- The app is a healthcare issue-reporting aid centered on quick voice/typed
  reporting. Keep it focused on fast, low-friction reporting for ward staff.
