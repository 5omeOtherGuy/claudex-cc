---
name: status
description: Show the current Claudex manager, gateway, authentication, and compatibility status.
allowed-tools: Bash
---

Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. Do not infer readiness
from a process alone; future status checks must validate health, authentication,
model availability, and launch configuration.
