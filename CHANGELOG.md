# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial public repository scaffold.
- Claude Code plugin manifest and skills for setup, login, config, status,
  doctor, update, and uninstall, backed by one deterministic control CLI.
- Validated versioned configuration with atomic persistence, presets
  (compatibility / balanced / max-reasoning), context-headroom rules, and a
  bounded gateway request policy.
- Pinned gateway management for CLIProxyAPI 8.0.32: checksum-verified
  install, atomic activation, staged smoke-gated updates, and one-command
  rollback (`claudex-pluginctl rollback`).
- Codex device/browser OAuth orchestration with fail-closed validation.
- Persistent (systemd user service) and per-session gateway lifecycles with
  the stable `claudex` launcher.
- macOS support: LaunchAgent and session-mode lifecycles ([#37]).
- Windows support: session mode and a stable launcher under
  `%LOCALAPPDATA%\claudex\bin` ([#38]).
- Tag-triggered release workflow with `SHA256SUMS.txt`, a CycloneDX SBOM, and
  build provenance, plus a manual protected live compatibility workflow
  ([#39]).
- Redacted status and doctor diagnostics with drift detection and guided
  relaunch messaging.
- Deterministic CI, security workflows, and worktree tooling.
- Public architecture, security, and implementation roadmap.

### Gateway pin

- CLIProxyAPI 8.0.32 (commit `911f49cb`) is the pinned, checksum-verified
  gateway release, replacing 7.2.86 (commit `81d70f5d`). An offline review
  found no change to the configuration keys, flags, login output, endpoints,
  or asset names Claudex depends on; the live promotion run is still pending.
  Existing installs move with `claudex-pluginctl update`, and `rollback`
  returns to 7.2.86. See `docs/compatibility-matrix.md`.
- Promotion of a newer release requires updating
  `docs/compatibility-matrix.md` and this changelog (enforced by
  `tests/release/promotion.test.ts`).

[Unreleased]: https://github.com/5omeOtherGuy/claudex-cc/commits/main
[#37]: https://github.com/5omeOtherGuy/claudex-cc/pull/37
[#38]: https://github.com/5omeOtherGuy/claudex-cc/pull/38
[#39]: https://github.com/5omeOtherGuy/claudex-cc/pull/39
