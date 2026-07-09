---
name: Hospital scoping (multi-tenant isolation)
description: How Friction Aid isolates reports/staff/insights/SSE per hospital, and the traps to avoid
---

Friction Aid is effectively multi-tenant by hospital. Isolation is centralised in
`activeHospitalId(req)` (session active department → user home hospital → null).
A null result means "not part of a hospital" and MUST hide reports, staff, and
insights.

**The rule:** every read/write that touches reports (or their children) must be
constrained to the viewer's active hospital. It is easy to scope the list
endpoints and forget the by-id ones.

**Where isolation must be enforced (all of these, or it leaks):**
- List/create reports.
- `PATCH /api/reports/:id` and both `/api/reports/:id/updates` (GET+POST) — the
  IDOR trap: id-addressed routes bypass list filters, so add the hospital check
  on each.
- `/api/insights` aggregates.
- `/api/hospitals` staff roster (reveal names only for the viewer's own dept;
  still send a `staff_count`) and `/api/staff`.

**Why:** a code review found cross-hospital IDOR through the by-id report routes
and global insights after only the list endpoints were scoped.

**SSE emergency broadcast — the subtle one.** `broadcast(event, hospitalId)`
only writes to SSE clients whose tag matches. Each `/api/events` connection is
tagged with `res.userId` + `res.hospitalId` at connect time. **A tag set once
goes stale when the user switches department mid-session**, leaking old-hospital
emergencies. Fix in place: the switch endpoint re-tags all live SSE clients for
that user id. Any new per-connection tag that can change during the session must
be refreshed the same way.

**Known, accepted limitation:** presence/staff filters by `users.hospital_id`
(home hospital), not the active department, so a user who switched departments
may show under their home dept in staff lists. Treated as non-blocking.
