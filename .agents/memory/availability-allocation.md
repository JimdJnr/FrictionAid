---
name: Availability & auto-allocation
description: How reports get auto-assigned to free staff, and the rules that keep claim/release and effective-free correct.
---

Reports are auto-allocated on create to a currently-free colleague; if nobody is
free the report is "Open" (`assigned_to IS NULL`). "All reports" was renamed
"Allocated reports".

- **Effective-free precedence**: a `busy` window covering "now" beats a `free`
  window, which beats the user's manual `availability_status` (default `free`).
  This ordering lives in `effectiveFreeUserIds()` — get it wrong and allocation
  picks people who are actually busy.
  **Why:** windows are explicit scheduled overrides; the manual toggle is the
  fallback default.

- **`assigned_to` is self-only**: `PATCH /api/reports/:id` accepts `assigned_to`
  only as the caller's own id (claim / take-over) or `null` (release). The only
  path that assigns *someone else* is server-side `pickAssignee()` at create time.
  **Why:** prevents one user dumping work onto another via the API.

- **pickAssignee preference order**: non-reporter first, then online (live SSE),
  then fewest active (non-resolved) assignments. Hospital-scoped like everything
  else.

- **Nav registry sync**: a new view (`open`, `schedule`) needs a `data-view`
  element in BOTH the sidebar rail AND the mobile bottom nav / More sheet, plus an
  entry in `MORE_VIEWS` in app.js if it's a secondary (More-sheet) destination, or
  it's unreachable on one form factor.

- Schedule voice uses its **own** `SpeechRecognition` instance, separate from the
  report wizard's voice engine — don't share one recognizer between them.
