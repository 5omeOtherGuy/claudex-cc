---
name: login
description: Authenticate the managed Codex gateway with device or browser OAuth.
allowed-tools: Bash, AskUserQuestion
---

Check `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. Runtime login is not
implemented yet. Never ask the user to paste callback URLs, authorization codes,
or tokens into chat. The planned default is device login in an interactive
terminal, with one active PKCE attempt at a time.
