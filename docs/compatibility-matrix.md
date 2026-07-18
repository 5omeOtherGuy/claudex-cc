# Compatibility matrix

| Claude Code | Claudex | Gateway | Models | Status | Notes |
|---|---|---|---|---|---|
| 2.1.214 | 0.1.0 scaffold | CLIProxyAPI 7.2.86 | Sol/Terra/Luna catalog | Research baseline | Runtime manager not implemented |

## Promotion gate

A combination is supported only after it passes:

- streamed text response
- client tool cycle
- parallel tool calls
- subagent request
- image input
- long-session compaction
- interrupted request and retry
- authentication refresh path
- first-token and terminal-event checks
- redacted diagnostic collection

Default CI covers deterministic fixtures. Live promotion tests run manually in a
protected environment with bounded usage and no secret-bearing logs.
