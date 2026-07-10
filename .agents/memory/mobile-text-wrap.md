---
name: Mobile horizontal-scroll from unwrapped user text
description: Why user-generated text blocks need overflow-wrap, and how mobile overflow is guarded
---

# Mobile horizontal scroll — user-content text must wrap

**Rule:** any block that renders user-supplied text from report/message data
(description, location/meta, acknowledgement note, outcome, message body) must
carry `overflow-wrap: anywhere` (or `word-break: break-word`). A single long
unbreakable token (URL, pasted ID) otherwise pushes the layout wider than the
phone viewport and produces horizontal scroll.

**Why:** the app's grids/flex rows are already responsive (collapse to 1fr,
`min-width:0`, `flex-wrap`), so the realistic mobile overflow source is text, not
layout. `.msg-body` had `word-break` from the start; the report-card text blocks
did not, which is what caused the reported horizontal scroll.

**How to apply:** when adding a new text block bound to user data, add
`overflow-wrap: anywhere`. There is also a belt-and-suspenders guard —
`.container` (the content scroll area) has `overflow-x: hidden` inside the
`@media (max-width: 560px)` query — but rely on wrapping for correctness, not the
clip.
