---
name: Conversation (group chat) roles & draft DMs
description: How group-chat permissions and Staff-view DM drafts work in the messaging feature
---

## Group-chat roles
- Per-member role lives in `conversation_members.role`: `owner` | `admin` | `member`.
  The creator is the `owner` (set on conversation create + backfilled for old rows).
- Permission model, all **enforced server-side** on the membership endpoints:
  - Add people: owner **or** admin (group-only, ids validated to active department like create).
  - Kick / change role: **owner only**; the owner is immutable (can't be removed,
    can't demote self).
- The client's `my_role` (returned per-conversation from `conversationSummaries`) and
  per-member `role` only show/hide controls — never a trust boundary.
- **Why:** mirrors the existing `access_level` authorization pattern — authorization
  belongs in the DB + server checks, not the client. See the same invariant for staff roles.
- **How to apply:** any new group action must re-check role via a server lookup
  (`convMemberRole`), scope to the active hospital (`memberConversation`), and
  `broadcast` a `type:"conversation"` nudge so lists + any open manage-modal refresh live.

## Staff-view "message a colleague" draft DMs
- Clicking a colleague in Staff opens a DM. If a 1:1 already exists it opens that;
  otherwise it opens a **temporary draft** (client-only `draftConv`, no DB row).
- The conversation is only created (POST `/api/conversations`) when the **first
  message is actually sent**. Unsent drafts are discarded on back / view switch /
  opening another thread.
- **Why:** the user explicitly wanted no DB row until a real message is sent, so the
  conversation list isn't polluted with empty conversations.

## Calls (live WebRTC video/audio)
- Calls are a full **mesh**: every participant holds one RTCPeerConnection to every
  other and streams peer-to-peer. The server is a **signaling relay only** — it never
  touches media. Signaling rides the shared `/api/events` SSE stream; offers/answers/
  ICE go through `POST .../call/signal` → SSE `type:"call-signal"`.
- Call membership is in-memory (`callRooms` Map, convId → Set of userIds), so — like
  presence and emergency SSE — it is **Reserved-VM-only** (Autoscale would split it).
- **Glare avoidance:** whoever is *already* in the call offers to each newcomer, so
  each pair negotiates in exactly one direction. The `call/join` handler computes the
  existing roster and adds the caller in **one synchronous block (no await between)**
  so concurrent joins can't miss each other; break that atomicity and two simultaneous
  joiners never connect to each other.
- **Media fallback:** client tries `getUserMedia({video,audio})` and falls back to
  `{audio}` when there's no camera / it's denied (audio-only call). Camera/mic toggles
  just flip `track.enabled` (no renegotiation).
- **Cleanup:** a user is dropped from all call rooms when their **last SSE connection**
  closes (closed tab / lost network = they leave), broadcasting `call-leave`.
- **STUN-only** (public Google STUN, no TURN): works on typical networks, may fail
  behind strict/symmetric NAT — a hosted TURN server would be needed for that.
- The old ephemeral `type:"ring"` is now the **incoming-call invite** (banner with
  Join/Decline); `POST .../ring` is kept as a low-level helper but the UI drives calls
  through `call/join`.
- **Why:** the user first chose "just a ring", then asked for real video (audio
  fallback) calling for group chats with no size cap.
- **How to apply:** media needs mic/camera permission and a **real browser tab** —
  blocked in the embedded preview iframe (same caveat as Web Speech voice input).
