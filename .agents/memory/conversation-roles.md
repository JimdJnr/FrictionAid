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
