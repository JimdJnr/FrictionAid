---
name: Real-time presence & SSE require Reserved VM, not Autoscale
description: Why this app must deploy on a VM — in-memory presence/SSE state breaks across Autoscale's multiple instances.
---

This app's "Staff online" presence and emergency alerts both rely on in-memory
server state: `sseClients` (the open Server-Sent Events streams) in `server.js`.
Presence is derived directly from `sseClients` (no separate map). Deploy on a
**Reserved VM** (single always-on instance), never Autoscale.

**Why:** Autoscale runs multiple ephemeral instances, each with its own process
memory. Two signed-in staff can land on different instances; instance A's
`sseClients` knows nothing about instance B's, so neither presence nor emergency
fan-out crosses instances. Symptom reported by the user: "I can't see other
people logged in in my own hospital." Emergency
SSE broadcasts have the same split — an emergency raised on one instance never
reaches clients connected to another. The API/query logic itself is correct
(verified: on a single instance, staff in the same hospital see each other).

**How to apply:** keep `.replit` `deploymentTarget = "vm"`. If anyone proposes
switching back to Autoscale (e.g. for cost), it will silently re-break presence
and cross-user emergency alerts unless presence is moved to the DB *and* SSE
fan-out is replaced with a cross-instance pub/sub (e.g. Postgres LISTEN/NOTIFY) —
a much larger change. Changing the deployment target requires the user to
re-publish for it to take effect.
