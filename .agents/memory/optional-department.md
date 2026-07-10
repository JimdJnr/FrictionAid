---
name: Optional department designation on reports
description: How the optional per-report department routing field works and its non-obvious constraints
---

Reports carry an OPTIONAL `department` (a routing designation naming which team
should handle the issue). It is distinct from `hospital_id` (which is confusingly
also called "department" in the data model — that's the tenant/ward isolation, not
this routing hint).

**Rule:** department is never required. It's captured only when the reporter names
one — via client keyword scoring (`detectDepartment()` over `DEPARTMENT_KEYWORDS`)
or the AI assist — or picked by hand from an optional dropdown on the Where step.

**Why:** the request was to let reporters optionally designate a team *without*
adding a mandatory field, and only when they mention it while describing the issue.

**How to apply:**
- `DEPARTMENTS` is an allowlist mirrored in BOTH `public/app.js` and `server.js`
  (allowlist-sync invariant). Server nulls any off-list value on POST /api/reports
  and in AI-assist extraction — so an unsynced client name is silently dropped.
- `DEPARTMENT_KEYWORDS` (detection phrases) is client-only, but its `name`s must
  match `DEPARTMENTS`. Avoid bare "it" in IT keywords — require "it team/support/
  desk…" so the English pronoun doesn't false-trigger.
- Manual dropdown change sets `manualDepartment` so smart-capture/AI won't override
  (mirrors the manualLocation/manualFeeling pattern). `setDepartment()` syncs the
  select and validates against the allowlist.
- AI assist: department is only extracted when clearly designated; the system prompt
  says never to ask for it.
