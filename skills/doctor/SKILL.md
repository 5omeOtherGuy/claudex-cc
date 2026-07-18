---
name: doctor
description: Diagnose Claudex installation and compatibility problems with redacted checks.
allowed-tools: Bash, AskUserQuestion
---

Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl doctor --offline` first and
report every check and remediation faithfully — exit code 1 simply means
problems were diagnosed, not that doctor itself failed.

If offline checks pass but the user still has problems, offer the online
checks: `claudex-pluginctl doctor` (gateway health, model inventory, token
counting). Only with the user's explicit consent in this conversation may you
add `--allow-live-inference`, which sends one minimal billed request; never
add that flag on your own.

Never read credential file contents, never print environment variables, and
never work around a failing check by weakening configuration — relay the
remediation instead. If doctor points at the launch mode, explain the guided
relaunch: start a new session via the `claudex` launcher; the current session
cannot switch providers.
