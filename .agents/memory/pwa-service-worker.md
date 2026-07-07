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
