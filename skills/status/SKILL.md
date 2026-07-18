---
name: status
description: Show the current Claudex manager, gateway, authentication, and compatibility status.
allowed-tools: Bash
---

Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status` and report every line
faithfully. Never infer readiness from a running process alone; only the CLI's
launch-readiness result counts.

Interpret the output for the user:

- `session:` says how the current session was launched. If it does not run
  through the gateway, explain the guided relaunch: finish or park this
  session, then start a new one with the `claudex` launcher. Never claim the
  running session can switch providers in place.
- `drift:` lines name configuration or version skew; point the user at the
  suggested command (`setup` or `update`) instead of editing files manually.
- `launch: blocked (...)` includes the failing readiness step and its
  remediation; relay it as-is.

Do not read credential files or echo environment variables; the CLI already
prints only redacted metadata.
