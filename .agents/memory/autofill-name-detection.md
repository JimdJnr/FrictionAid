---
name: Reporter-name auto-detection must be conservative
description: Why detectIdentity only uses explicit lead-ins plus a stopword guard
---

Auto-filling the reporter's name/nickname from the free-text description is
inherently false-positive-prone: ordinary clinical prose looks like names once
you follow a lead-in word.

**Rule:** `detectIdentity` accepts only explicit self-identification lead-ins —
"my name is / my name's X" (named) and "call me / you can call me / nickname is
X" (pseudonym) — and every captured name is passed through a `NAME_STOPWORDS`
reject guard (`extractName`) so the match is dropped when the first captured
word is a common non-name continuation.

**Why:** Real user testing + review surfaced misfires. "by X" patterns caught
roles ("raised by nurse in charge" → "Nurse In"); ambiguous lead-ins caught
prose ("call me when you can" → "When You", "please report as urgent" →
"Urgent", "under the name of safety" → "Of Safety"). A wrong auto-filled name is
worse than none in a psychological-safety tool where identity is sensitive.

**How to apply:** Never broaden name detection with generic lead-ins ("this is",
"from", "by", trailing sign-offs) or you reintroduce these false positives. If
you add a lead-in, add adversarial negatives (prose that follows it) to the test
matrix first. Location detection can be broad (low stakes); name detection must
stay narrow.
