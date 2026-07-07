---
name: CSS animation fill-mode vs hover transforms
description: Why entrance animations that also need :hover transform must use fill-mode backwards, not both
---

When an element has a one-shot entrance keyframe (e.g. a `riseIn` fade/slide-up)
**and** a `:hover` (or `:active`) rule that changes `transform`, do not use
`animation-fill-mode: both` (or `forwards`).

**Why:** `forwards`/`both` pins the animation's final keyframe values after it
ends. Because animations win over normal declarations while their fill applies,
the pinned `transform` overrides the `:hover { transform: ... }`, so the hover
lift silently stops working.

**How to apply:** Use `animation-fill-mode: backwards` instead. It still holds
the *start* keyframe during any pre-animation delay (needed for staggered
entrances so items stay hidden until their turn), but after the animation
finishes the element reverts to its normal declared/default values — leaving
`transform` free for hover/active states. This only matters when the element's
own hover changes an animated property; containers whose children (not
themselves) get the hover are unaffected.

Also: entrance animations retriggered by toggling a class need a forced reflow
between remove and re-add (`el.classList.remove(cls); void el.offsetWidth;
el.classList.add(cls);`) or the browser coalesces it and nothing replays.

Always gate motion behind a `@media (prefers-reduced-motion: reduce)` block that
sets `animation: none !important; transition: none !important;` and neutralises
hover transforms.
