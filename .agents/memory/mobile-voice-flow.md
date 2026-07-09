---
name: Mobile hands-free voice flow
description: How the phone-only dictation chain walks the wizard and auto-submits, and the guards that keep it from looping or firing on desktop.
---

# Mobile hands-free voice flow

On phones only, dictating the description on wizard step 1 starts a hands-free
chain that fills each remaining step by voice and finally auto-submits.

## The rules that matter
- **Phone-only + description-only trigger.** The chain (`voiceFlow`) is armed in
  `startVoice` only when the target is the description *and* `isMobileView()`
  (`matchMedia("(max-width:560px)")`). Manual location/feeling mic taps and all
  desktop use keep `voiceFlow` false and behave exactly as before.
- **Driven by the silence timer, not `onend`.** After ~3s of no speech the silence
  timer stops listening and calls `advanceVoiceFlow(finishedTarget)`. Capture the
  target *before* `stopVoice` (it resets state).
- **Route to the next unfilled step, once each.** location (if `#location` empty) →
  feeling (if `feelingApplies()` && no feeling) → `submitReport()`. Each step is
  guarded by `voiceFlowPrompted.{location,feeling}` so a *silent* reporter advances
  instead of being re-prompted forever. Without this guard, silence on a step loops.
- **Nav between steps needs settle delays.** `goToStep` then `startVoice` for the
  next field must be deferred (setTimeout ~500–600ms) so the view switch + the old
  recognition's async `onend` finish before a new engine starts.
- **Manual control cancels.** Every manual Next/Back handler and the feeling mic
  button call `resetVoiceFlow()`. Also cleared in `resetForm`.
- **Spoken cue must gate the mic.** On each step jump `promptVoiceStep` speaks the
  cue via `speechSynthesis` and starts recognition only in the utterance's
  completion callback — otherwise the mic transcribes the prompt itself. `speakPrompt`
  must call its callback exactly once (`onend`/`onerror` + timeout fallback) or a
  dropped `onend` / missing TTS stalls the whole chain. Note `window.speechSynthesis`
  is a read-only property, so it can't be monkey-patched in tests — stub via the
  onerror/fallback path instead.

**Why:** free-text auto-submit must never fire an Emergency broadcast — Emergency
stays manual/two-step, and `detectPriority`/assist cap at High, so the auto-submit
path can only ever create ≤High reports.

**How to apply:** if you add a new wizard step or a new voice target, extend
`advanceVoiceFlow`'s routing + a matching `voiceFlowPrompted` guard, and make sure
any manual entry into that step calls `resetVoiceFlow()`.
