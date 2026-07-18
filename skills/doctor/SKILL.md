---
name: doctor
description: Diagnose Claudex installation and compatibility problems with redacted checks.
allowed-tools: Bash
---

Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl doctor --offline`. Report the
result faithfully. Do not read credential file contents or print environment
variables. Live checks are not implemented in the repository scaffold.
