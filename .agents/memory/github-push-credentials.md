---
name: GitHub push credentials
description: Why the agent cannot push to a user's connected GitHub repo from the environment
---

The agent environment (and background/task-agent environments) do NOT hold the
user's GitHub credentials. `git ls-remote origin` / push against a user's
GitHub `origin` fails with "Invalid username or token. Password authentication
is not supported." Only Replit's built-in **Git panel** (OAuth connection) can
push to the user's GitHub repo.

**Why:** GitHub auth for the Git panel is an OAuth token stored by Replit and
wired only into the panel's credential helper, not exposed to the shell or to
isolated task environments. Private repos also block unauthenticated read.

**How to apply:** Never promise to push/merge-and-push to a user's GitHub from
the agent side or via a background Project Task — it will fail on auth. Diagnose
read-only (`git --no-optional-locks status/log/remote -v`, `ls-remote` to test
auth), then hand the actual push back to the user via the Git panel. For a
diverged history caused by GitHub creating an "Initial commit" (README) at repo
creation, the reliable panel-only fix is to recreate the GitHub repo empty (no
README/.gitignore/license) and Push, or use the panel's Force push if available.
