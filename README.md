# Claudex

Run Codex subscription models in Claude Code through a managed localhost gateway with OAuth, diagnostics, updates, and rollback.

Status: pre-release. Usable from a checkout, with no tagged release yet;
commands and configuration may still change without notice.

[![CI](https://github.com/5omeOtherGuy/claudex-cc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/5omeOtherGuy/claudex-cc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

Claudex is a Claude Code plugin and launcher. It installs and runs a pinned,
checksum-verified [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateway on `127.0.0.1`, signs you in to Codex with browser or device OAuth, and
starts Claude Code with that gateway as its model provider. Updates are staged
and smoke-tested with one-command rollback, and every diagnostic is redacted.

Claude Code plugins can add skills, agents, hooks, MCP servers, and executables,
but they cannot register a primary model provider or change the transport of a
running session. Claudex therefore has two cooperating layers:

1. a Claude Code plugin for setup, configuration, diagnostics, updates, and
   guided relaunch;
2. a stable pre-launch manager that starts the gateway and supplies the model
   environment before Claude Code starts.

```text
Claude Code plugin ──manages──▶ stable claudex launcher
                                      │
                                      ▼
                            local gateway sidecar
                                      │
                                      ▼
                             Codex OAuth backend
```

Normal `claude` sessions stay unchanged, and a running session never switches
providers; only new `claudex` launches use the gateway. Replacing the sidecar
with a translator built into Claudex requires a new ADR (see
[ADR 0001](docs/adr/0001-managed-sidecar-architecture.md) and
[`docs/roadmap.md`](docs/roadmap.md)).

> [!IMPORTANT]
> Claudex is unofficial. Anthropic does not support routing Claude Code to
> non-Claude models through a gateway, and Claudex is not endorsed,
> maintained, or audited by Anthropic, OpenAI, or the CLIProxyAPI maintainers.
> Upstream terms, entitlement, quota, and protocol changes can affect
> availability.

## Install

Claudex has no plugin marketplace entry yet, so install it from a checkout of
this repository:

```bash
git clone https://github.com/5omeOtherGuy/claudex-cc.git
cd claudex-cc && npm ci && npm run build
claude --plugin-dir "$(pwd)"
```

## Usage

Inside Claude Code, run `/claudex:setup`. It installs the pinned gateway, the
persistent service where the platform has one, and the stable `claudex`
launcher (`~/.local/bin` on Linux and macOS, `%LOCALAPPDATA%\claudex\bin` on
Windows; add it to `PATH` once). Setup opens the browser OAuth flow and
verifies authentication. Then start a new session from your terminal:

```bash
claudex
```

`claudex` checks that the gateway is installed, logged in, and healthy, sets
the gateway and model environment for that process only, and launches Claude
Code.

```text
/claudex:setup      guided install and configuration menus
/claudex:login      device/browser Codex OAuth (runs in your terminal)
/claudex:config     presets and validated settings
/claudex:status     gateway, auth, drift, and session guidance
/claudex:doctor     redacted diagnostics with remediations
/claudex:update     staged, smoke-gated gateway updates with rollback
/claudex:uninstall  removal with an explicit credential decision
```

The skills call the control CLI, which also works directly from the checkout,
for example `bin/claudex-pluginctl doctor --offline` or
`bin/claudex-pluginctl status`. When something fails, start with those two and
see [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Configuration

Use `/claudex:config`, or the CLI:

```bash
bin/claudex-pluginctl config show
bin/claudex-pluginctl config preset            # list compatibility, balanced, max-reasoning
bin/claudex-pluginctl config preset balanced
bin/claudex-pluginctl config set reasoning.effort high
bin/claudex-pluginctl config reset
```

Settings cover the runtime mode (`persistent` or `session`), the main,
subagent, and fallback models, reasoning effort, context and output budgets,
and retries. Every write is validated and atomic. Changes apply to the next
`claudex` launch. The options and their trade-offs are described in
[`docs/architecture/compatibility-boundary.md`](docs/architecture/compatibility-boundary.md).

## Compatibility

- Node.js 22.19 or newer.
- Claude Code 2.1.214 with CLIProxyAPI 8.0.32 and the GPT-5.6 Sol, Terra, and
  Luna models. Checked on 2026-10-17 with deterministic tests and a
  credential-free gateway run; no live compatibility run has passed yet.
- Linux (systemd user service or session mode), macOS (LaunchAgent or session
  mode), and Windows (session mode).

Details and the promotion gate are in
[`docs/compatibility-matrix.md`](docs/compatibility-matrix.md); platform notes
are in [`docs/platforms/macos.md`](docs/platforms/macos.md) and
[`docs/platforms/windows.md`](docs/platforms/windows.md).

## Development

```bash
npm ci
npm run check                                           # the gate
node --test --import tsx tests/gateway/manifest.test.ts # one test file
```

`npm run check` runs lint and format checks, a secret scan, type checking, the
tests, the build, plugin validation, and a pack dry run; CI runs the same
command in the `gate` job. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
worktree and pull request workflow, and
[`docs/architecture/overview.md`](docs/architecture/overview.md) for the design.

## Contributing, support, and security

- Bugs, compatibility reports, and feature requests: [issues](https://github.com/5omeOtherGuy/claudex-cc/issues/new/choose).
- Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Vulnerabilities: report privately as described in [`SECURITY.md`](SECURITY.md).
  Never include credentials, callback URLs, prompt payloads, or raw
  authorization headers in issues or logs.

## License

[MIT](LICENSE). Third-party notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
