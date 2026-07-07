---
name: Auth model & real-name attribution decision
description: Non-obvious product decisions behind Friction Aid's auth (recoverable details are in replit.md)
---

Durable decisions a future agent can't infer from the code alone:

- **Custom email+password auth was chosen deliberately over Replit Auth.** If
  asked to swap the auth mechanism, confirm first — this was an explicit choice.
- **Anonymous / nickname / pseudonymous reporting was intentionally removed**, not
  overlooked. Do not reintroduce a client-supplied reporter name, an identity
  selector, or name-parsing from the description (the old `detectIdentity` was
  deleted for this reason). Every report/update/acknowledgement must be
  attributed to the signed-in account's real name.

(Mechanics — scrypt, sessions, legacy `reporter`/`identity_mode` columns kept for
old rows — are documented in `replit.md`.)
