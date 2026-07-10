---
name: Admin account & testing ground
description: How the shared admin account and sandbox department are modelled, and why a non-email login works.
---

# Admin account & testing ground

A shared **admin** account lets admins trial the full reporting flow in an
isolated **Testing Ground** hospital without touching real ward data. Entry
point lives in the Profile/Settings view. (The literal demo credentials live in
`server.js` / `replit.md`, not here — see `ADMIN_SEED`.)

**Why `admin` works as a login even though accounts are "email + password":**
`/api/login` does an exact `WHERE email = $1` match with **no email-format
validation**, so a seeded row with `email = 'admin'` logs in fine. Registration
does validate, but the admin row is *seeded*, not registered.

**Isolation is free via existing hospital scoping.** The Testing Ground is a
real `hospitals` row; because reports/insights/staff are already scoped to the
viewer's active hospital, admin test reports never leak into real departments and
vice-versa. No separate "sandbox mode" was needed — reuse the tenant boundary.

**Seeding is idempotent and self-healing.** Testing Ground is in `HOSPITAL_SEED`;
the admin user is `INSERT … ON CONFLICT (email) DO NOTHING` followed by an
`UPDATE … SET is_admin = TRUE` so an older admin row gets the flag on next boot.
Password hash uses a random salt each boot, but ON CONFLICT means it's only
written once, so the password stays stable.

**Destructive reset is server-gated.** `POST /api/testing-ground/reset` checks
`req.user.is_admin` (not just UI hiding) and only deletes reports in the Testing
Ground hospital; `report_updates` cascade. Client hides the reset button when
`currentUser.is_admin` is false, but the server is the real guard.

**How to apply:** any future "special" seeded account can follow the same pattern
(non-email login + seed + idempotent flag sync). Keep destructive admin actions
gated on `is_admin` server-side, never UI-only.
