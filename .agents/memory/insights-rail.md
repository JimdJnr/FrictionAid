---
name: Desktop insights rail
description: The always-on right-hand insights panel — when it shows, and how it stays in sync.
---

# Desktop insights rail

`#insightsRail` (`.ol-insights`) is a third flex column inside `.ol-body`, after
`.container`. It's a condensed companion to the full Insights view — a 2×2 stat
grid plus category/priority bars, all built from the **same `/api/insights`
payload** and the shared `barList()` / `formatDuration()` helpers.

**When it shows:** display:none by default; only shown at `@media (min-width:
1200px)`. So it never appears on phone/tablet. The `.rail-hidden` class hides it
again even on wide screens — set in `activateView()` for any view that **owns the
right-hand column itself**, so that view reclaims the space ("perma-open *unless
something needs that space*").

**Why it must also hide on views with their own numbers:** the rail is
hospital-wide and obeys *no* view's filters. A view that shows its own
differently-scoped figures in a right-hand panel (the issue map's room detail,
for instance) reads as contradicting it — a map filtered to Emergency showing 0
sitting beside a rail showing 1. This was reported as a data bug during testing
when both were on screen at once. Any new view that gains a right-hand panel or
its own filtered totals must be added to the `.rail-hidden` list.

**Keeping it in sync (why the fetch guard matters):**
- `refreshInsightsRail(force)` is called from `activateView()` (every nav) and
  `reloadActiveView()` (after report mutations). It **bails out entirely** when
  `railVisible()` is false (narrow viewport or `.rail-hidden`) — no wasted fetch.
- It has a 15s TTL so rapid view-switching doesn't hammer the endpoint; pass
  `force = true` after real data changes (mutations) or when the rail first
  becomes visible on a resize (`matchMedia change` listener), to bypass the TTL.

**Nav wiring gotcha:** the rail's "Open" button routes through `activateView`
only because `.ol-insights-link` was added to the shared `tabs` selector. Any new
`data-view` control outside the sidebar/bottom-nav needs the same treatment.

**How to apply:** any future rail/companion panel should follow the same shape —
reuse the existing endpoint + render helpers, gate the fetch on actual
visibility, and bump `sw.js` CACHE when its shell assets change.
