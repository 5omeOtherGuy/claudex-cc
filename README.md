# Claudex

Claudex is a Claude Code plugin and launcher that manages a secure,
localhost-only gateway for running Codex subscription models in Claude Code:
guided setup, device/browser OAuth, per-session or persistent gateway
lifecycles, staged checksum-verified updates with rollback, and redacted
diagnostics — all driven by one deterministic control CLI.

> [!IMPORTANT]
> Claudex is unofficial and pre-release (no tagged release yet). See the
> [security and support boundary](#security-and-support-boundary) below.

## Why this architecture

Claude Code plugins can add skills, agents, hooks, MCP servers, and executables,
but they cannot register a primary model provider or replace the current
session's model transport. Claudex therefore has two cooperating layers:

1. a Claude Code plugin for setup, configuration, diagnostics, updates, and
   guided relaunch;
2. a stable pre-launch manager that starts a pinned Anthropic-compatible gateway
   and supplies the required environment before Claude Code starts.

The gateway implementation is a checksum-verified, pinned
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) release. Building a
new protocol translator is explicitly out of scope.

```text
Claude Code plugin ──manages──▶ stable claudex launcher
                                      │
                                      ▼
                            local gateway sidecar
                                      │
                                      ▼
                             Codex OAuth backend
```

## Installation

Until the first marketplace release, install from a packed checkout:

```bash
git clone https://github.com/5omeOtherGuy/claudex-cc.git
cd claudex-cc && npm ci && npm run build
claude --plugin-dir "$(pwd)"
```

Then, inside Claude Code, run `/claudex:setup` — it installs the pinned,
checksum-verified gateway, the persistent service where available, and the
stable `claudex` launcher (`~/.local/bin` on Linux/macOS,
`%LOCALAPPDATA%\claudex\bin` on Windows; add it to `PATH` once). Setup opens the
browser OAuth flow itself and verifies authentication before directing you to a
new `claudex` session.

## User experience

```text
/claudex:setup      guided install and configuration menus
/claudex:login      device/browser Codex OAuth (runs in your terminal)
/claudex:config     presets and validated settings
/claudex:status     gateway, auth, drift, and session guidance
/claudex:doctor     redacted diagnostics with remediations
/claudex:update     staged, smoke-gated gateway updates with rollback
/claudex:uninstall  removal with an explicit credential decision
```

`claudex` validates the local gateway (readiness ladder: installed →
logged in → healthy), sets the gateway and model environment for that
process only, and launches Claude Code. Normal `claude` sessions remain
unchanged, and a running session never switches providers — only new
`claudex` launches use the gateway.

Platform support: Linux (persistent systemd user service + session mode),
macOS (LaunchAgent + session mode), Windows (session mode). Details:
[`docs/platforms/macos.md`](docs/platforms/macos.md),
[`docs/platforms/windows.md`](docs/platforms/windows.md).

## Troubleshooting

Start with `claudex-pluginctl doctor --offline` (add `status` for launch
readiness and drift). See [`docs/troubleshooting.md`](docs/troubleshooting.md)
for the common failure modes and their remediations; every error message in
the CLI names its remediation, and diagnostics are redacted by design.

## Technology stack

- Node.js 22.19+ and npm
- strict TypeScript ESM with NodeNext module resolution
- Node built-ins for filesystem, process, networking, hashing, and tests
- Biome for formatting and linting
- GitHub Actions on Linux, macOS, and Windows
- a pinned upstream CLIProxyAPI binary as the gateway

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
