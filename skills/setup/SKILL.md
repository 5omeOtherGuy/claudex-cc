---
name: setup
description: Install and configure the managed Claudex gateway and stable launcher.
allowed-tools: Bash, AskUserQuestion
---

Guide the user through Claudex setup. All behavior lives in the control CLI;
never duplicate its logic, invent success, modify Claude Code settings, or ask
for credentials in chat.

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status` to see the current
   state. If everything is already ready, say so and stop.
2. Before installing, offer the configuration choices with AskUserQuestion
   (each answer maps to `claudex-pluginctl config set <key> <value>`):
   - Runtime mode (`runtime.mode`): `persistent` (background gateway service,
     recommended) or `session` (a gateway per launch).
   - Models (`models.main`, `models.subagent`, `models.fallback`): keep the
     defaults unless the user wants specific Codex models.
   - Reasoning effort (`reasoning.effort`): low / medium / high / xhigh / max.
   Keep defaults for anything the user does not want to decide.
3. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup` and report each
   step's result faithfully, including failures and their remediations. Setup
   downloads only the pinned, checksum-verified gateway release; if
   verification fails it installs nothing — never work around that.
4. Authentication method: ask whether the user wants device login
   (recommended, default) or browser login. Then tell them to run
   `claudex-pluginctl login` (add `--browser` for browser mode) themselves in
   an interactive terminal. Do not run login from this skill and do not ask
   them to paste codes, callback URLs, or tokens into chat.
5. Explain the session limitation clearly: this Claude Code session keeps its
   current provider; the plugin cannot switch providers mid-session. After
   login succeeds, the user starts a new session with the `claudex` launcher
   (ensure `~/.local/bin` is on PATH) to use the gateway.
