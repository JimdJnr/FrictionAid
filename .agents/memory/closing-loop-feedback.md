---
name: Closing-the-loop feedback prompt
description: Why the post-resolution "did this get sorted?" ask is split between server gates and one client-only gate, and why it must defer rather than drop.
---

## The four gates are deliberately split across the stack
Three eligibility conditions (resolved / at least a few minutes old / never asked)
are server-side; the fourth — "the reporter isn't part-way through filing another
report" — is client-side.

**Why:** only the browser knows about an in-progress wizard; there is no server-side
notion of a half-typed report. Putting three gates in SQL keeps the one-shot honest
across tabs and devices, while the fourth stays where the information actually lives.

**How to apply:** never try to move the composing check server-side, and never relax
the server gates to compensate for a client that "should" know better.

## Claiming the ask is destructive — defer, never drop
Displaying the prompt latches a timestamp column, which permanently removes that
report from the due list. So the client must only claim when it can show the card
immediately, and once a card is on screen it must be *held* (in memory) rather than
dismissed if the reporter starts composing.

**Why:** an early version claimed on a point-in-time check and then hid the card when
the user started typing — the ask was consumed and the reporter was never asked
again. There is no un-claim path.

**How to apply:** any new "not a good moment" condition must route into the pending
slot and be re-offered later. Re-check the composing gate after *every* await in the
check→claim→show chain, because the user can start typing mid-round-trip.

## "Shown" is latched, but "answered" is not — so a claimed ask is lost on refresh
The latch marks the ask as *delivered* at display time, while the hold that survives
composing lives only in browser memory. A reload between the two loses the ask
permanently, and there is no un-claim path.

**Why:** the latch exists to stop duplicate asks across tabs, which needs server
state; the defer/restore behaviour needs no server state, so it never got any.
Accepted deliberately — the cost of a missed ask was judged lower than the cost of
asking twice.

**How to apply:** if the ask ever needs to survive a reload, the fix is a durable
"delivered but unanswered" state the client can re-read, not a weaker latch.

## Don't gate on derived state
The composing check must key on inputs the user directly owns (text fields, wizard
step), never on state the app infers from them.

**Why:** the auto-detected category was briefly part of the gate. Clearing the text
fields doesn't deselect a category, so the gate latched on forever and the held ask
could never be handed back — a permanent stall from a value the user never set.

**How to apply:** for any "is the user busy?" check, ask whether every contributing
signal has a user-reachable path back to false.
