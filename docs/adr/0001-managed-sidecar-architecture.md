# ADR 0001: Managed sidecar architecture

- Status: Accepted
- Date: 2026-07-18

## Context

Claude Code plugins cannot register a primary model provider, intercept the model
transport, or change the parent process environment after startup. Codex models
require translation from Anthropic Messages to an OpenAI/Codex protocol.

## Decision

Claudex uses a Claude Code plugin as its control plane and a stable pre-launch
manager that owns a localhost gateway sidecar. The initial sidecar is a pinned,
checksum-verified CLIProxyAPI release.

## Consequences

- Setup requires a guided relaunch; in-place provider switching is not claimed.
- The user does not manually install or configure the gateway.
- Lifecycle, update, rollback, security, and compatibility are product concerns.
- A custom translator is deferred and requires a new ADR.
