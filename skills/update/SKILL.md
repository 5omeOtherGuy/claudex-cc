---
name: update
description: Safely update Claudex or its pinned gateway with verification and rollback.
allowed-tools: Bash, AskUserQuestion
---

Updates are staged and checksum-verified; the previous gateway version is kept
for rollback. Never download or execute anything yourself — the control CLI is
the only updater.

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl update --check` and show
   the user the plan: current version, target version, SHA-256, and the
   compatibility impact line. If it reports "Nothing to do", stop here.
2. Ask with AskUserQuestion whether to apply the update now, and separately
   whether to include the two consent-gated live smoke checks (streaming and
   tools; one minimal billed request each, via `--allow-live-inference`).
   Never add that flag without an explicit yes in this conversation.
3. On confirmation, run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl update`
   and report each step faithfully. The candidate is staged on a temporary
   endpoint first; health, model-inventory, and token-count smoke checks gate
   activation, and a failed post-activation health check rolls back to the
   previous version automatically. If the output says rollback did not
   complete, tell the user to run doctor before launching — do not retry
   blindly.
4. If the user needs to return to the previous gateway version later, the
   one-command recovery is `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl
   rollback` — report its steps faithfully too.
5. After a successful update, remind the user that running `claudex` sessions
   keep their current gateway process; the update takes effect for new
   `claudex` launches (the persistent service was already restarted by the
   CLI).
