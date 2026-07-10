---
name: Presence roster is a snapshot — broadcast presence changes
description: Why staff online/offline dots go stale and how live refresh works
---

Server-side presence in Friction Aid is always accurate (derived live from open
`/api/events` SSE connections tagged with userId+hospitalId). The bug users hit
is on the **client**: the staff/hospitals roster is a one-shot fetch, so a
colleague who connects *after* you loaded the roster shows offline forever until
a manual refresh.

**Rule:** any event that changes who is online — SSE connect, SSE disconnect, and
department switch (re-tag) — must `broadcast({type:"presence"}, hospitalId)` to
the affected department(s). The client's `/api/events` handler re-fetches the
on-screen roster (`loadStaff()` / `loadHospitals()`) when it sees a `presence`
event.

**Why:** presence being correct in the DB/connection list is not enough; nothing
pushes it to other browsers, so their rosters silently drift. A department switch
must nudge BOTH the old and new hospital (capture old tag before overwriting it).

**How to apply:** keep the presence broadcast next to every place that mutates
`sseClients` membership or a connection's `hospitalId`. Do not add a separate
presence store (see the "no parallel store" invariant) — the broadcast only tells
clients to re-derive from the live connections.
