# Security model

## Protected assets

- OAuth access, refresh, and ID tokens
- local gateway client secret
- authorization codes and callback URLs
- prompts, source code, tool inputs, and tool outputs
- downloaded executable artifacts
- logs and compatibility traces

## Trust boundaries

1. Claude Code plugin prompt and tool execution
2. stable Claudex manager
3. local gateway process
4. provider-owned OAuth storage
5. upstream release and model services

## Required controls

- credential directories are owner-only and secret files are mode 0600 on Unix
- local listeners bind to loopback and require a client credential
- OAuth defaults to device flow for remote/headless use
- only one PKCE browser attempt is active at a time
- callback material never enters chat, issues, logs, or shell history by design
- artifacts are pinned, checksum-verified, staged, and rollback-capable
- diagnostics use metadata only and central redaction
- default CI has no real credentials or live provider access
- normal `claude` configuration is not modified

## Fail-closed behavior

Claudex refuses to:

- execute an unverified binary,
- write secrets to a group/world-readable path,
- bind a gateway to a non-loopback address without an explicit future design,
- claim OAuth success before persistence and an authenticated validation step,
- delete credentials during uninstall without a separate explicit choice,
- remove a worktree branch when merged status cannot be verified.
