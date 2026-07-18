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
2. For reasoning/context/output/retry tuning, offer the named presets first
   (`claudex-pluginctl config preset` lists them with descriptions):
   - `compatibility` — most conservative; use when sessions hit limits.
   - `balanced` — the shipped defaults.
   - `max-reasoning` — deepest reasoning and largest output budget.
   Apply with `claudex-pluginctl config preset <name>`; presets never touch
   models, runtime mode, or advanced options.
3. Offer individual changes with AskUserQuestion menus and apply each choice
   with `claudex-pluginctl config set <key> <value>`:
   - Runtime mode: `runtime.mode` = `persistent` | `session`.
   - Models: `models.main`, `models.subagent`, `models.fallback`.
   - Reasoning effort: `reasoning.effort` = low | medium | high | xhigh | max.
   - Context compatibility: `context.advertisedWindow`, `context.compactAt`,
     `context.maxOutputTokens` (validation enforces output + tool/reasoning
     headroom below the advertised window).
   - Request policy: `requests.retries` (0–10, transient failures only).
   - Advanced (explicit opt-in; consequences documented in
     docs/architecture/compatibility-boundary.md): `advanced.sessionAffinity`,
     `advanced.streamingKeepaliveSeconds`, `advanced.streamingBootstrapRetries`,
     `advanced.remoteModelCatalog`.
4. The CLI validates every write and fails closed; report validation errors
   verbatim instead of retrying with guesses. `config reset` restores
   defaults and keeps a backup.
5. Explain when a change takes effect: running `claudex` sessions keep their
   environment; runtime and model changes apply to the next `claudex` launch
   (persistent-mode gateway changes may additionally need
   `claudex-pluginctl setup` or `update` to rewrite the service
   configuration).
