---
name: Phone-only elements need a base display:none
description: Mobile-only fixed UI (FAB, bottom sheet, bottom nav) whose show rules live inside the ≤560px media query must also have a base hide rule, or they leak onto desktop.
---

Any element that should appear **only on phones** (≤560px) and whose `display`
rules live entirely inside the mobile media query MUST also have a base
`display: none` rule outside the query in `public/style.css`.

**Why:** the mobile bottom nav (`.bottomnav`) already had a base
`.bottomnav { display: none }` + media-query show, so it worked. A newly-added
`.compose-fab` (and `.more-sheet` / `.more-backdrop`) only had show rules
(`.compose-fab:not(.hidden)`) inside the ≤560px query, with no base rule — so on
desktop/tablet the element had no `display` rule at all and rendered as a normal
in-flow button at the bottom of the page. JS (`showApp`) unconditionally removes
`.hidden`, so `.hidden` can't gate it by viewport.

**How to apply:** when adding phone-only chrome, pair every media-query show rule
with a base `<selector> { display: none }` outside the query. Let the mobile
`:not(.hidden)` show rule (higher specificity) win inside the breakpoint. Do not
rely on JS `.hidden` toggling alone to hide mobile-only elements on desktop.
