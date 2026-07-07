---
name: Auto-fill must never auto-set Emergency priority
description: Why description-driven auto-fill caps urgency at High and never selects Emergency
---

The New Report form parses the "Describe it" text to pre-fill priority, feeling,
location, and reporter identity. Priority detection must only ever yield
Low/Medium/High — **never Emergency**.

**Why:** Emergency is a high-stakes, broadcast action (it pushes an SSE event +
flashing banner/alert tone to every connected client) and is deliberately
guarded by a two-step "click again to confirm" control to prevent misfires.
Auto-selecting it from free text would bypass that safeguard and let ambiguous
or negated language ("not an emergency") trigger a real broadcast.

**How to apply:** Keep `detectPriority` returning only Low/High/null (default
Medium). Map urgent language to High and leave Emergency as a manual, confirmed
choice. Any future NLP/LLM-based capture must preserve this boundary.

Related parsing rules that keep auto-fill trustworthy:
- Auto-fill only writes to fields the reporter hasn't touched (manual* flags);
  programmatic `.value` writes don't fire `input`, so they don't trip the flags.
- Priority matching checks the Low list first (so "not urgent" beats the "urgent"
  substring), uses word-boundary matching, and strips negated urgency phrases
  before scanning the High list.
