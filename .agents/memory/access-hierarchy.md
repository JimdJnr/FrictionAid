---
name: Management hierarchy (access_level)
description: Role ladder for staff management — where authorization lives and the grant/manage rules.
---

# Management hierarchy

Role ladder: `member < it < it_lead`, with the seeded admin (`is_admin`) ranking
above all. Authorization lives in the **`users.access_level`** column, computed via
`accessRank()` (server) — **never** in the free-text `profession`.

**Why:** `profession` is user-editable at registration and via `PATCH /api/me`, so
using it for authorization would let anyone self-promote. `access_level` is only
writable through `PATCH /api/staff/:id` by a higher-ranked colleague.

**How to apply:**
- IT+ (`rank ≥ 1`) can add members (`POST /api/staff`, always created as `member`)
  and change a member's `profession`.
- IT Lead+ (`rank ≥ 2`) can additionally set `access_level`.
- You may only act on someone **strictly below** your rank, and only grant a role
  **below** your own rank (IT Lead grants member/it, admin grants member/it/it_lead).
  You cannot edit yourself via this route.
- The client mirror (`accessRank`/`ACCESS_LABELS`/`ACCESS_ORDER` in `app.js`) only
  shows/hides controls; the server re-checks every action.
- All `/api/staff` mutations are active-hospital scoped (IDOR), like reports.
