# Claudex

Claudex is an early-stage Claude Code plugin and launcher that will manage a
secure, localhost-only gateway for running Codex subscription models in Claude
Code.

> [!IMPORTANT]
> This repository currently contains the public architecture and implementation
> scaffold. The installer, OAuth flow, and managed gateway are not usable yet.

## Why this architecture

Claude Code plugins can add skills, agents, hooks, MCP servers, and executables,
but they cannot register a primary model provider or replace the current
session's model transport. Claudex therefore has two cooperating layers:

1. a Claude Code plugin for setup, configuration, diagnostics, updates, and
   guided relaunch;
2. a stable pre-launch manager that starts a pinned Anthropic-compatible gateway
   and supplies the required environment before Claude Code starts.

The initial gateway implementation will be a checksum-verified, pinned
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) release. Building a
new protocol translator is explicitly outside the MVP.

```text
Claude Code plugin ──manages──▶ stable claudex launcher
                                      │
                                      ▼
                            local gateway sidecar
                                      │
                                      ▼
                             Codex OAuth backend
```

## Planned user experience

```text
/claudex:setup
/claudex:login
/claudex:config
/claudex:doctor
/claudex:status
/claudex:update
/claudex:uninstall
```

After setup, `claudex` will validate the local service, set the gateway and model
environment for that process, and launch Claude Code. Normal `claude` sessions
remain isolated.

## Technology stack

- Node.js 22.19+ and npm
- strict TypeScript ESM with NodeNext module resolution
- Node built-ins for filesystem, process, networking, hashing, and tests
- Biome for formatting and linting
- GitHub Actions on Linux, macOS, and Windows
- a pinned upstream CLIProxyAPI binary for the initial gateway

See [`docs/technology-stack.md`](docs/technology-stack.md) and
[`docs/architecture/overview.md`](docs/architecture/overview.md).

## Development

```bash
npm ci
npm run check
```

After the bootstrap commit, the primary checkout is control-only. New work starts
in a task worktree:

```bash
npm run preflight
git worktree add ../claudex-cc-123 -b feat/123-example origin/main
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security and support boundary

Claudex handles executable downloads and OAuth-backed credentials. Never include
credentials, callback URLs, prompt payloads, or raw authorization headers in
issues or logs. Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/5omeOtherGuy/claudex-cc/security/advisories/new).

Anthropic does not support routing Claude Code to non-Claude models through a
gateway. Claudex is unofficial and is not endorsed, maintained, or audited by
Anthropic, OpenAI, or the CLIProxyAPI maintainers. Upstream terms, entitlement,
quota, and protocol changes can affect availability.

## License

Claudex is licensed under the [MIT License](LICENSE). Third-party notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
