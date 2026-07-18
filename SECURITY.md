# Security policy

## Supported versions

Claudex is in early development. Only the latest commit on `main` is supported
until the first stable release.

## Report a vulnerability

Do not open a public issue for security problems. Use
[GitHub Security Advisories](https://github.com/5omeOtherGuy/claudex-cc/security/advisories/new).

Include the affected commit or release, impact, reproduction steps, and whether
the issue has been disclosed elsewhere. Remove all credentials, callback URLs,
account identifiers, prompts, and payload bodies.

## Security-sensitive scope

In scope:

- OAuth orchestration and credential metadata handling
- local gateway authentication and lifecycle
- artifact download, checksum verification, activation, and rollback
- permission enforcement and secret redaction
- launch environment isolation
- diagnostics and log handling
- plugin hooks and command execution

Out of scope:

- vulnerabilities in Claude Code, Anthropic, OpenAI, Node.js, or CLIProxyAPI
  itself; report them to the relevant upstream project
- issues requiring an attacker who already controls the user's account and can
  execute arbitrary code as that user, unless Claudex materially worsens impact

## Invariants

- OAuth tokens and local gateway keys never enter prompts, tool outputs, issue
  templates, telemetry, or normal diagnostics.
- Credential directories are owner-only; files are mode 0600 on Unix.
- Local services bind to loopback by default and require a client credential.
- Downloaded executables are version-pinned and checksum-verified before use.
- Configuration and binary activation are atomic and rollback-capable.
- Errors are redacted before display or persistence.
- Default CI is offline and uses fake credentials.

## Upstream and account risk

Claudex uses an unofficial gateway path for non-Claude models in Claude Code.
Availability may change because of upstream protocol, entitlement, quota, account,
region, or terms changes. This repository does not guarantee continued access to
any subscription-backed model.
