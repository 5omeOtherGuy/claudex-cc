# ADR 0004: Gateway-owned OAuth credentials

- Status: Accepted
- Date: 2026-07-18

## Context

OAuth tokens rotate, are larger than simple plugin secrets, and are consumed by
the gateway data plane. Duplicating them into plugin configuration increases
exposure and refresh races.

## Decision

The gateway owns OAuth token persistence and refresh. Claudex orchestrates login,
validates safe metadata, enforces directory/file permissions, and never copies
raw tokens into prompts, project settings, or diagnostics.

## Consequences

- Uninstall asks separately whether provider credentials should be retained.
- Diagnostics inspect metadata and authenticated behavior, not token contents.
- A future gateway replacement must provide a deliberate credential migration.
