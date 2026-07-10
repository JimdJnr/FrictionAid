---
name: Insights charts
description: The Insights page uses hand-rolled SVG/CSS charts (no chart library) — keep it that way.
---

# Insights charts

The Insights page renders its graphs with **hand-rolled SVG (line) and CSS
column bars — no charting library**. This is deliberate: the frontend is a
vanilla, no-build static app served under a service worker, so a CDN/bundled
chart lib would add offline-caching and shell-versioning complexity for little
gain.

**Why keep it hand-rolled:** consistency + zero new deps + full control over
theme tokens (charts use `var(--brand/--danger/--warn/--ok/--line/--muted)` so
dark mode "just works"). If you add another chart, follow the same pattern
rather than reaching for a library.

**Emotional-feedback line = a time series, gap-filled server-side.** The
`feelingTrend` aggregate in `/api/insights` uses `generate_series` + left join so
quiet days appear as explicit zeros — the client assumes a continuous, evenly
spaced daily series (last 14 days) and just plots points at fixed x-steps. If you
change the window, keep the gap-fill or the line will jump across missing days.

**Accessibility:** each chart is `role="img"` with an `aria-label` summarising the
data (screen readers can't read the SVG geometry); SVG line points also carry
`<title>` tooltips.

**Layout:** the Insights view is intentionally wider than other views
(`#insightsView` max-width bumped) and lays cards out in a responsive
`.insights-grid`; the headline chart spans the full row (`.insights-wide`).
Collapses to one column on phones.

**Headline is a single selectable chart.** Instead of one fixed graph, the
headline card has a `<select>` (graph-type dropdown) driving one shared chart
container; the chosen type is held in a module-level variable so it survives the
periodic insights re-fetch / view-switch re-render (re-rendering reuses the
cached last payload — no refetch on switch). Default view is emotional feedback
as **bars**. When adding a new headline graph, add it to the options list AND
the render switch, and keep it reading from the already-fetched insights data.
