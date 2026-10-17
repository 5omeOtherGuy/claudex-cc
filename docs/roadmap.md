# Roadmap

Work state lives in GitHub issues; this page only summarizes the phases.

## Done: the managed-gateway product (unreleased 0.1.0)

Everything the original epic [#20] planned is implemented on `main` and recorded
under `Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md):

- validated configuration, presets, context headroom, and a bounded gateway
  request policy;
- the pinned, checksum-verified CLIProxyAPI gateway with staged, smoke-gated
  updates and one-command rollback;
- Codex browser and device OAuth;
- session mode on every platform, a systemd user service on Linux, and a
  LaunchAgent on macOS;
- the stable `claudex` launcher on Linux, macOS, and Windows;
- the `/claudex:*` plugin skills and redacted status and doctor diagnostics;
- deterministic cross-platform CI, CodeQL, the release workflow (checksums,
  SBOM, provenance), and the protected live compatibility workflow.

## Blocking the first release

1. A protected live compatibility run passes the
   [promotion gate](compatibility-matrix.md#promotion-gate) for the pinned
   combination, and the matrix records it.
2. The `v0.1.0` tag, cut by following the
   [release checklist](release-checklist.md).

## Next phase: owned translator (epic [#43])

Epic [#43] plans to make Claudex a standalone Anthropic Messages ↔ Codex
Responses translator and then remove CLIProxyAPI entirely. It starts with the
architecture ADR in [#44], which must supersede the current "no custom
translator" boundary ([ADR 0001](adr/0001-managed-sidecar-architecture.md))
before any translator code lands. Its child issues are listed in the epic in
their mandatory delivery order.

[#20]: https://github.com/5omeOtherGuy/claudex-cc/issues/20
[#43]: https://github.com/5omeOtherGuy/claudex-cc/issues/43
[#44]: https://github.com/5omeOtherGuy/claudex-cc/issues/44
