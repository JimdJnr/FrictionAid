---
name: Liquid emerald background
description: How the animated canvas background is layered, kept cheap, and why host surfaces are transparent.
---

# Liquid emerald background

A fixed, full-viewport animated backdrop (`public/liquid-bg.js` + `liquid-bg.css`)
behind all app content: Canvas 2D, no deps, additive soft radial-gradient blobs
CSS-blurred into "molten glass".

**Cheapness comes from rendering small + blurring, not from fewer draws.** The
canvas is sized to a *fraction* of the viewport (scale tier) and a large CSS
`blur()` (set from JS) hides the low resolution while fusing blobs. Adaptive
quality = device-signal starting tier (mobile / hardwareConcurrency / deviceMemory)
plus a live FPS watchdog that steps DOWN a quality ladder if fps < ~42 over 2s.

**Why host surfaces are transparent:** `body` and `.auth-screen` backgrounds were
made `transparent` in `style.css` so the `z-index:-1` layer shows through. The
sign-in screen was previously an opaque blue gradient — if you reintroduce any
opaque full-screen background there, the liquid disappears behind it.

**How to apply / gotchas:**
- Lifecycle must stay leak-free: pause on `visibilitychange`, cancel rAF + clear
  the debounced resize timer on `pagehide`. Don't start rAF under
  `prefers-reduced-motion` — draw one static frame instead (CSS also ships a
  static gradient fallback so it's never blank).
- It's a shell asset: keep `liquid-bg.css`/`liquid-bg.js` in sw.js `APP_SHELL`
  AND the network-first code-asset branch, and bump the `CACHE` version whenever
  they change (same rule as app.js/style.css).
