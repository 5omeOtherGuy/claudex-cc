---
name: login
description: Authenticate the managed Codex gateway with device or browser OAuth.
allowed-tools: Bash, AskUserQuestion
---

Help the user authenticate the managed gateway. Login itself always runs in
the user's own interactive terminal so that no authorization URLs, device
codes, or callback material ever enter this chat.

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. If credentials
   are already present and launch readiness is OK, say so and stop. If no
   gateway is installed, point the user to `/claudex:setup` first.
2. Ask (AskUserQuestion) which method the user prefers:
   - Device login (recommended): shows a short code to enter on the provider's
     device page; works headless and over SSH.
   - Browser login: opens the provider's sign-in page in a local browser.
3. Tell the user to run the matching command themselves in a terminal:
   - Device: `claudex-pluginctl login`
   - Browser: `claudex-pluginctl login --browser`
   Only one login attempt runs at a time; a second attempt reports `locked`.
   Never run the login command from this skill, never capture its output into
   chat, and never ask the user to paste codes, URLs, or tokens here.
4. After the user reports completion, verify with
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status` and report the result
   faithfully. Success is only real when status shows credentials present and
   launch readiness OK — do not claim it otherwise.
5. Remind the user: an already-running Claude Code session keeps its current
   provider. To use the gateway, start a new session via the `claudex`
   launcher.
