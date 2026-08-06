---
name: Report attachments & on-device drafts
description: Where a report's photo lives and why it never rides in list JSON; how the wizard's localStorage draft is scoped and wiped.
---

# Report photos

Photos are stored the way avatars are — a size-capped data URL on the record
itself — rather than through object storage.

**Rule:** the photo column is never selected into any list query. Lists carry
only a `has_photo` boolean; the bytes come from a dedicated per-report endpoint
that re-parses the data URL and re-applies hospital scoping.

**Why:** a ward page renders dozens of reports at once. A ~1 MB base64 image per
row turns a routine list fetch into tens of megabytes over hospital wifi. The
boolean keeps the list cheap while still letting the card know to render an
image.

**How to apply:** when adding any new heavy per-row blob (a second photo, an
audio note, a signature), follow the same shape — boolean in the row, bytes on
their own scoped endpoint — rather than widening the shared report select.

Client-side downscaling is a courtesy for the network, never a validation.
The server re-checks MIME type and length independently, and rejects rather
than truncates.

# On-device drafts

The report wizard autosaves to `localStorage`, keyed per signed-in user id.

**Rule:** the draft is wiped on submit *and* on sign-out, and expires on its
own after a week.

**Why:** ward devices are shared. A half-written report — which may describe a
situation in a specific bay — must not be waiting for whoever signs in next.
Sign-out is the boundary; keying by user id alone is not enough because it only
prevents *display* to another user, not the data sitting there.

**How to apply:** any future draft/scratch state (a half-composed message, an
unsent update) needs the same two wipes, not just the user-id key.

Storage quota is a real failure mode once a photo is in the draft. On
`QuotaExceededError` the text is kept and the photo dropped, with a flag so the
restore notice can say the picture didn't survive — silently losing the typed
description is much worse than losing the picture.
