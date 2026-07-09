---
name: PWA service worker caching boundary
description: What the service worker must never cache, and how updates propagate
---

Friction Aid is a PWA; `public/sw.js` caches the app shell for offline/fast load.

**Rule:** The service worker must **never** cache or intercept `/api/*` — it
returns early for that path prefix (this includes the SSE stream `/api/events`).
Only static shell assets (html/css/js/icons/manifest) are cached.

**Why:** Caching API responses would serve stale reports/insights, break the
auth gate (a cached authed response could show to a logged-out client or vice
versa), and freeze the live emergency SSE stream. Reports, auth, and emergency
events must always hit the network.

**How to apply:**
- Never add `/api/*` to the cache list or a cache-first branch.
- When any shell asset changes, bump the `CACHE` version string in `sw.js` or
  clients keep serving the old cached shell (old caches are purged on activate,
  keyed by that string).

**Deploy propagation (bitten twice):** `skipWaiting()` + `clients.claim()` +
network-first for `app.js`/`style.css` are necessary but **not sufficient** — an
already-open tab keeps running the JS/CSS it loaded under the *previous* worker,
so a just-deployed build looks broken (e.g. nav clicks do nothing, bottom nav
renders unstyled at the page bottom) until a manual refresh. The registration in
`index.html` must listen for `controllerchange` and `location.reload()` **once**
(guard with a `refreshing` flag to avoid a loop) so the tab self-heals onto the
new build. Symptom to recognise: user reports features "don't work" / layout
wrong *only* on the published/standalone tab while the dev preview is fine —
that's a stale controller, not a code bug.
