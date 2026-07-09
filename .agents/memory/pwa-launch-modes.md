---
name: PWA launch modes (two apps, one page)
description: How one index.html installs as two distinct home-screen PWAs via a ?launch= param + swapped manifest, and drives different on-open behaviour.
---

# PWA launch modes

The single `public/index.html` can install as **two separate installable PWAs**,
each opening into a different mode, without duplicating the SPA.

## How it works
- A `?launch=` query param selects the mode: `report` (open compose + start
  listening immediately) or `insights` (open the Insights dashboard).
- An **inline `<script>` in `index.html`'s `<head>`** (runs before `app.js`) reads
  the param, sets `window.__LAUNCH_MODE`, and **swaps `#manifestLink`'s href** (and
  the iOS `apple-mobile-web-app-title`) to that mode's manifest. This must run in
  the head so the browser's install prompt registers the *mode-specific* manifest.
- Each mode has its own manifest (`manifest-report.webmanifest` /
  `manifest-insights.webmanifest`) with a **distinct `id`, `name`, and `start_url`**
  (the `?launch=` URL). The distinct `id` is what lets both installs coexist as
  separate apps on the same origin.
- `showApp()` branches on `window.__LAUNCH_MODE`: `report` forces voice via
  `maybeAutostartVoice(true)` (ignores the per-user `voice_autostart` pref);
  `insights` just `activateView("insights")`; anything else keeps the normal
  default view + opt-in autostart.

**Why:** a browser only reads the one manifest linked from the current page, so two
installable apps normally need two pages. Swapping the manifest link by query param
lets one page serve both — avoiding a full duplicate of the large index.html/app.js.

**How to apply:** to add another launch mode, add a manifest with a unique `id` +
`start_url`, extend the head script's `manifests` map, add a branch in `showApp()`,
and add the manifest to the SW `APP_SHELL` (bump the cache version).
