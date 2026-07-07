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
