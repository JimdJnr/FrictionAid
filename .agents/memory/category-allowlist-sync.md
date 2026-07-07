---
name: Category allowlist sync
description: The issue-type category list is duplicated across frontend and backend and must stay in sync
---

The report issue-type list exists in two places: `CATEGORIES` in
`public/app.js` (drives the chips + auto-categorize keywords) and `CATEGORIES`
in `server.js` (an allowlist validated on POST/GET). They must match exactly.

**Why:** the POST handler rejects any `category` not in the server allowlist
with HTTP 400 ("A valid category is required."). Renaming/adding a category in
the frontend without updating server.js silently breaks new-report submission.

**How to apply:** whenever you add, remove, or rename an issue-type category,
edit both files in the same change and verify with a curl POST. Existing DB rows
keep their old category strings and still render, but old names won't match the
new "All reports" category filter.
