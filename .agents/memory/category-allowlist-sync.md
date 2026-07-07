---
name: Allowlist sync (categories & feelings)
description: Enum-style lists (issue categories, reporter feelings) are duplicated across frontend and backend and must stay in sync
---

Two enum-style lists are duplicated across the client and server and must match
exactly:

- `CATEGORIES` in `public/app.js` (drives the chips + auto-categorize keywords)
  and `CATEGORIES` in `server.js` (allowlist validated on POST/GET).
- `FEELINGS` in `public/app.js` (the optional "how did this make you feel?"
  chips) and `FEELINGS` in `server.js` (allowlist validated on POST).

**Why:** the server validates against its own allowlist. An unknown `category`
is rejected with HTTP 400 ("A valid category is required."), silently breaking
new-report submission. An unknown `feeling` is quietly coerced to null, so a
frontend-only feeling addition just never saves — a silent data loss rather than
an error. Either way, editing one side without the other breaks the feature.

**How to apply:** whenever you add, remove, or rename a category or feeling,
edit both files in the same change and verify with a curl POST. Existing DB rows
keep their old strings and still render, but old category names won't match the
"All reports" category filter.

There is a third, client-only list keyed by category: the `ROUTES` map in
`public/app.js` (category → owning team, shown as the escalation route). It is
display-only (no server validation), but a category whose name isn't a `ROUTES`
key silently falls back to "Ward manager" instead of erroring. So renaming or
adding a category means updating three places: `CATEGORIES` in both files **and**
`ROUTES` in `public/app.js`.
