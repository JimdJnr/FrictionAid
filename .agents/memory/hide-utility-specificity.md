---
name: .hidden utility must win over ID layout rules
description: Why the .hidden hide utility uses !important — an ID selector layout rule was overriding it and stacking views.
---

The `.hidden { display: none !important }` utility in `public/style.css` MUST keep
its `!important`.

**Why:** view switching (`activateView`) hides inactive views by adding the
`.hidden` class. `.hidden` is a plain class (specificity 0,0,1,0). The desktop
media query styles the New report view with an **ID selector**
`#reportView { display: grid }` (specificity 1,0,0), which beat `.hidden`. Result:
on desktop, switching to Hospitals/Settings/Staff/etc left `#reportView` visible
and the selected view rendered *stacked below it* — the user saw the new section
"added at the bottom" instead of replacing the report form. Class-based views
(`.view`) hid fine; only the ID-targeted `#reportView` leaked.

**How to apply:** never remove the `!important` from `.hidden`. If you add
ID-based `display` rules for any view, they will silently re-break hiding unless
`.hidden` stays authoritative. Prefer class selectors over ID selectors for
per-view layout so this can't recur.

This was misdiagnosed once as a stale service-worker cache issue; it was a pure
CSS specificity bug reproducible in a fresh browser.
