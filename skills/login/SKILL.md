---
name: login
description: Authenticate the managed Codex gateway through a guided browser flow.
allowed-tools: Bash, AskUserQuestion
---

Run authentication as a controlled, in-product workflow. Keep updates concise;
do not ask the user to copy commands or paste terminal output during the normal
browser flow.

1. Say `[1/3] Checking authentication state.` Run
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`.
   - If credentials are owner-only and launch readiness is OK, say
     `Claudex authentication is ready.` and stop.
   - If the gateway is missing, direct the user to `/claudex:setup` and stop.
2. Say `[2/3] Opening secure browser sign-in.` Run
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl login --browser` yourself with
   Bash and allow at least six minutes for completion. The manager opens the
   provider sign-in page, waits for the callback, normalizes credential
   permissions, and validates an authenticated request.
3. Never print or request authorization URLs, callback URLs, device codes,
   tokens, credential filenames, account identifiers, or raw headers. Relay only
   the manager's redacted progress and final result.
4. If browser login fails because no local browser or callback is available, ask
   whether to **Retry browser login (Recommended)**, **Use device login**, or
   **Stop**. Run a retry yourself. Device login is the only fallback that must
   run in the user's interactive terminal because its one-time code must not
   enter chat; print the resolved absolute command, never bare
   `claudex-pluginctl`, and ask the user to reply only `done` or `failed`.
5. Say `[3/3] Verifying authentication.` Run
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. Claim success only when
   it confirms owner-only credentials and launch readiness.
6. State the session boundary once: the running Claude Code session keeps its
   current provider; start a new gateway-backed session with `claudex`.
