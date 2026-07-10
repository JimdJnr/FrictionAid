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

**Emotional feedback = a single stacked bar per selected timeframe (not a time
series).** `/api/insights` returns `feelingWindows`: an object keyed by rolling
window id (`hour/day/d3/week/w2/month/m3/year`), each an array of
`{feeling,count}` for feelings present in that window. Computed in ONE query via
`COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '…')` per window, then
pivoted server-side. Windows are a fixed internal list (`FEELING_WINDOWS` in
server.js ↔ `FEELING_WINDOW_OPTIONS` in app.js) so the intervals are safe to
inline into SQL. The client renders one horizontal `.stack-bar` of colour
segments + a `.stack-key` legend; the timeframe `<select>` swaps windows from the
already-cached payload (no refetch). **`FEELING_COLOR` (app.js, client-only) must
have a key for every FEELINGS name** or that feeling falls back to `--brand` and
becomes indistinguishable in the stack. The old per-day line/`feelingTrend` and
the `lineChart`/`shortDay` helpers were removed.

**Accessibility:** each chart/stacked bar is `role="img"` with an `aria-label`
summarising the data; individual stack segments carry `title` tooltips.

**Layout:** the Insights view is intentionally wider than other views
(`#insightsView` max-width bumped) and lays cards out in a responsive
`.insights-grid`; the headline chart spans the full row (`.insights-wide`).
Collapses to one column on phones.

**Headline is a single selectable chart.** Instead of one fixed graph, the
headline card has a `<select>` (graph-type dropdown) driving one shared chart
container; the chosen type is held in a module-level variable so it survives the
periodic insights re-fetch / view-switch re-render (re-rendering reuses the
cached last payload — no refetch on switch). Default is the emotional-feedback
**stacked bar** (with its own timeframe sub-select); the other option is By
priority. When adding a new headline graph, add it to the options list AND the
render switch (`insightsChartHtml`), and keep it reading from the already-fetched
insights data.
