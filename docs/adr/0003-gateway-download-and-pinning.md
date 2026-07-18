# ADR 0003: Download and pin the upstream gateway

- Status: Accepted
- Date: 2026-07-18

## Context

Bundling every platform binary makes the plugin large and complicates updates.
Building a translator from scratch duplicates active compatibility work.

## Decision

Claudex downloads an exact upstream CLIProxyAPI asset selected from a committed
OS/architecture manifest and verifies its SHA-256 checksum before execution.
Versions install side by side and activation is atomic.

## Consequences

- First setup requires network access unless the asset is preseeded.
- Release manifests become security-sensitive reviewed code.
- Upstream licensing notices remain in the distribution.
- Rollback does not require redownloading the previous version.
