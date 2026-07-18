---
name: config
description: View or change validated Claudex runtime, model, and compatibility settings.
allowed-tools: Bash, AskUserQuestion
---

Use the control CLI for every configuration read and write; never edit config
files directly, never touch global Claude Code model settings, and never store
gateway credentials in project files.

1. Show the current state with
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl config show`.
2. Offer changes with AskUserQuestion menus and apply each choice with
   `claudex-pluginctl config set <key> <value>`:
   - Runtime mode: `runtime.mode` = `persistent` | `session`.
   - Models: `models.main`, `models.subagent`, `models.fallback`.
   - Reasoning effort: `reasoning.effort` = low | medium | high | xhigh | max.
   - Context compatibility: `context.advertisedWindow`, `context.compactAt`,
     `context.maxOutputTokens` (validation enforces headroom; named presets
     arrive in a later release).
3. The CLI validates every write and fails closed; report validation errors
   verbatim instead of retrying with guesses. `config reset` restores
   defaults and keeps a backup.
4. Explain when a change takes effect: running `claudex` sessions keep their
   environment; runtime and model changes apply to the next `claudex` launch
   (persistent-mode gateway changes may additionally need
   `claudex-pluginctl setup` to rewrite the service configuration).
