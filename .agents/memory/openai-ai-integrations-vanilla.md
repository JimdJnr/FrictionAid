---
name: OpenAI AI Integrations in a vanilla (non-framework) app
description: How to wire keyless OpenAI via Replit AI Integrations into a plain Node/Express app, and blueprint gotchas.
---

# OpenAI via Replit AI Integrations in a vanilla app

Replit AI Integrations gives keyless OpenAI access billed to Replit credits. In a
plain Node/Express app you do NOT need the blueprint's scaffolding — just
construct the client from two env vars the integration sets:
`AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`.

**How to apply:** build a small `getOpenAIClient()` that reads those two env vars
and returns `null` when either is unset (so the endpoint can return 503 while the
integration is still being connected). Construct a fresh client per request; do
not cache it.

**Blueprint gotchas:**
- The `javascript_openai_ai_integrations` blueprint has
  `askForBlueprintConfirmation: true`, so `addIntegration` won't apply directly —
  call `proposeIntegration(...)` instead. That call **exits the agent loop** and
  waits for the user to complete setup, so do it LAST, after all your code is
  built, or you'll be blocked without being able to test.
- The blueprint ships TS/React/Drizzle modules (chat/audio/image/batch helpers)
  that DON'T fit a vanilla app. They land under `.replit_integration_files/` as
  staging. They are inert (never imported) — ignore them.
- You cannot `rm` `.replit_integration_files/` from bash: the sandbox blocks
  edits to any `.replit*`-prefixed path. Leave the staging dir in place.
