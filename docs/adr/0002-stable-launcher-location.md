# ADR 0002: Stable launcher outside the plugin cache

- Status: Accepted
- Date: 2026-07-18

## Context

Marketplace plugins live in versioned cache paths, while the gateway environment
must be prepared before Claude Code starts.

## Decision

Setup installs a small stable `claudex` launcher in a user executable directory.
Versioned manager and gateway assets live in user data directories and activate
through an atomic pointer.

## Consequences

- Plugin updates do not break shell paths.
- The launcher can validate and start the gateway before Claude Code loads.
- Install and uninstall must manage stable files explicitly and avoid unrelated
  executables.
