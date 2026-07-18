# Architecture overview

## Goal

Give users one guided setup path for running Codex subscription models in Claude
Code without manually installing, configuring, authenticating, supervising, or
updating a translation gateway.

## Supported boundary

Claude Code plugins cannot register a primary model provider or change the
parent process environment after startup. Claudex therefore separates control
plane, startup boundary, and data plane.

```text
Claude Code plugin
  ├─ setup/login/config/status/doctor/update/uninstall skills
  ├─ conflict and compatibility guidance
  └─ deterministic control CLI
            │
            ▼
stable claudex manager and launcher
  ├─ validated configuration
  ├─ artifact verification and activation
  ├─ OAuth orchestration
  ├─ service/session lifecycle
  ├─ launch environment isolation
  └─ update and rollback
            │
            ▼
localhost-only gateway sidecar
  ├─ Anthropic Messages endpoint
  ├─ streaming and tool translation
  ├─ Codex OAuth refresh
  └─ health, models, and token counting
```

The current Claude Code session cannot switch providers in place. Setup ends by
guiding the user to relaunch through the stable `claudex` command.

## Runtime modes

### Persistent

A user service keeps the gateway available between sessions. This is the Linux
default and later the macOS default. It improves startup time and preserves
process-local gateway state, but requires explicit update and stale-service
handling.

### Session

The launcher starts a gateway on a loopback port, launches Claude Code, and stops
the gateway afterward. This is the portable fallback and initial Windows mode.

## Ownership

- The plugin owns user interaction and guidance.
- The manager owns configuration, artifacts, lifecycle, diagnostics, and launch.
- The gateway owns OAuth token persistence and protocol translation.
- Claude Code owns the agent loop and tool execution.

## Non-goals for the MVP

- native Claude Code provider registration
- monkey-patching Claude Code network code
- a new protocol translator
- remote gateway exposure
- automatic live-account tests on pull requests
- modifying the user's normal `claude` defaults
