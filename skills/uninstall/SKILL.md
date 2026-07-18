---
name: uninstall
description: Remove Claudex runtime components with an explicit credential-retention choice.
allowed-tools: Bash, AskUserQuestion
---

Uninstall removes only what Claudex installed: the gateway service, the
`claudex` launcher, installed gateway versions, and runtime state. Foreign
CLIProxyAPI installations, unmanaged launchers, and normal Claude Code
configuration are never touched — the CLI refuses rather than deletes.

1. Confirm the user wants to uninstall at all.
2. Ask two separate AskUserQuestion decisions — never bundle them:
   - Credentials: keep the stored Codex credentials (default suggestion, for
     easy reinstall) or delete them.
   - Configuration: keep the Claudex config file or delete it too.
3. Run the matching command and report each step faithfully:
   - Keep credentials: `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl uninstall --keep-credentials`
   - Delete credentials: add `--delete-credentials` instead; add
     `--delete-config` only if the user chose to drop the configuration.
   The CLI refuses to run without an explicit credential flag — that is by
   design; never pick one silently.
4. If a step reports a foreign launcher or unit, tell the user which file was
   left in place and why instead of forcing removal.
5. Afterwards remind the user: normal `claude` sessions were never modified;
   removing the plugin itself happens through Claude Code's plugin management.
