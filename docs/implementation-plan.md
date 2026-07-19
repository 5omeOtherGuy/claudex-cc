# End-to-end implementation plan

This document is the public source for the GitHub implementation epic and its
child issues. GitHub issue numbers are added after creation.

## Epic goal

Deliver Claudex as a safe, usable, cross-platform Claude Code plugin and launcher
that installs and manages a pinned local CLIProxyAPI gateway, authenticates with
Codex OAuth, launches Claude Code with isolated model routing, and provides
configuration, diagnostics, updates, rollback, and uninstall without requiring
manual proxy administration.

## Epic definition of done

- A new user can install the plugin, run guided setup, authenticate, and launch a
  working `claudex` session without manually editing YAML, shell startup files,
  Claude Code global settings, or service definitions.
- Normal `claude` sessions remain unchanged.
- Linux supports persistent and session modes; macOS supports LaunchAgent and
  session modes; Windows supports session mode.
- In-product browser OAuth is the default; device OAuth remains the safe
  terminal fallback for headless and remote sessions.
- Gateway artifacts are pinned, checksum-verified, staged, and rollback-capable.
- Configuration is validated and written atomically; credentials and logs follow
  the documented security model.
- Plugin skills provide setup, login, config, status, doctor, update, and
  uninstall workflows backed by one deterministic control CLI.
- Compatibility presets, context and response headroom, and bounded retries are
  implemented and documented; a proxy-side output cap remains deferred until
  the pinned gateway has a compatibility-tested mechanism.
- Deterministic CI, cross-platform smoke tests, security scanning, release
  artifacts, SBOM/checksums, and a protected live compatibility workflow exist.
- Installation, troubleshooting, security, contribution, compatibility, and
  release documentation are complete.
- At least one tagged public release passes the compatibility promotion gate.

## Child issues

### 1. Repository foundation and public architecture baseline

**Goal:** Establish a secure, deterministic project foundation that supports
parallel worktree development and public contribution.

**Definition of done:**

- TypeScript manager and Claude Code plugin scaffold build successfully.
- CI runs lint, typecheck, tests, build, plugin validation, and package dry run.
- Linux, macOS, and Windows portability jobs exist.
- CodeQL, dependency review, Dependabot, issue forms, and security policy exist.
- Worktree preflight, primary sync, and fail-closed cleanup scripts are tested.
- Public architecture, ADRs, compatibility matrix, license, and notices exist.

### 2. Validated configuration, paths, and atomic persistence

**Goal:** Provide one versioned, cross-platform configuration model for all
manager behavior without storing secrets in project files.

**Definition of done:**

- Schema, defaults, migration version, and validation errors are implemented.
- XDG/macOS/Windows paths are covered by deterministic tests.
- Writes are atomic and retain a recoverable previous version.
- Loopback, context-headroom, and secret-path rules fail closed.
- CLI supports redacted `config show`, validated `config set`, and reset.

### 3. Gateway artifact manifest, installation, and activation

**Goal:** Install the correct pinned CLIProxyAPI binary safely for the current
platform.

**Definition of done:**

- Committed manifest maps supported OS/architecture pairs to exact assets and
  SHA-256 hashes.
- Downloads use TLS, bounded timeouts, temporary files, and checksum validation.
- Versions install side by side and activate atomically.
- Unsupported platforms and checksum failures execute nothing.
- Offline fixture tests cover install, corruption, interrupted download, and
  activation rollback.

### 4. Secure Codex OAuth orchestration

**Goal:** Make authentication reliable in local, remote, and headless sessions
without exposing callback material.

**Definition of done:**

- Browser flow is the in-product default, reports only bounded redacted progress,
  and accepts success only after the pinned gateway validates the real callback
  state for that active attempt.
- Device flow remains available as an interactive-terminal fallback for
  headless sessions.
- OAuth success requires persistence plus an authenticated validation request.
- Credential metadata is safe to inspect; token contents never enter diagnostics.
- Timeout, denial, state mismatch, entitlement, and refresh failures have tests
  and targeted remediation.

### 5. Session-mode gateway lifecycle

**Goal:** Launch an isolated gateway for one Claude Code session and clean it up
reliably.

**Definition of done:**

- Manager selects or validates a loopback port and per-session client secret.
- Startup waits for health with a bounded timeout.
- Claude Code receives the gateway/model environment before process start.
- Signals and normal exit terminate the owned sidecar without killing unrelated
  processes.
- Port conflict, crash, timeout, and stale-state tests pass on all CI platforms.

### 6. Linux persistent service lifecycle

**Goal:** Provide fast, resilient Linux startup through a user-owned systemd
service.

**Definition of done:**

- Service unit is generated from validated paths and runs with umask 077.
- Install, enable, start, stop, restart, status, and removal are idempotent.
- Existing unrelated CLIProxyAPI services are detected and never overwritten.
- Health, stale PID, port conflict, and rollback behavior are tested.
- Session mode remains available when systemd is absent or declined.

### 7. Stable launcher and Claude Code environment isolation

**Goal:** Make `claudex` the single reliable pre-launch entry point while leaving
normal `claude` untouched.

**Definition of done:**

- Stable launcher is installed outside versioned plugin caches.
- It validates readiness, selects main/subagent models, and executes Claude Code.
- No global Claude model or base-URL setting is required.
- Conflicting legacy launchers and global custom-model settings are diagnosed.
- Arguments, exit codes, signals, and platform quoting are tested.

### 8. Status and doctor diagnostics

**Goal:** Turn setup and compatibility failures into redacted, actionable output.

**Definition of done:**

- Status reports manager, gateway, auth metadata, service, model, and launch
  readiness without reading token contents.
- Doctor checks versions, checksums, permissions, bind address, health, model
  inventory, token counting, and configuration conflicts.
- JSON and human-readable output are stable and tested.
- Optional live inference requires explicit consent and bounded usage.
- Every failure maps to one remediation and preserves secrets.

### 9. Claude Code plugin setup, login, and configuration UX

**Goal:** Provide guided in-product setup backed by the deterministic manager.

**Definition of done:**

- `/claudex:setup`, `/claudex:login`, and `/claudex:config` are implemented.
- Menus cover runtime mode, models, presets, and authentication method.
- Skills call the manager rather than duplicating business logic.
- The current session limitation and required relaunch are explained clearly.
- No credential or callback material is requested in chat.

### 10. Plugin status, doctor, update, uninstall, and relaunch UX

**Goal:** Complete the operational plugin surface for daily use and recovery.

**Definition of done:**

- `/claudex:status`, `/claudex:doctor`, `/claudex:update`, and
  `/claudex:uninstall` are implemented.
- Session-start guidance detects incorrect launch mode and configuration drift.
- Update shows version/checksum/compatibility impact before applying.
- Uninstall separately confirms credential retention and preserves unrelated
  installations.
- Guided relaunch starts a new `claudex` session without claiming in-place
  provider switching.

### 11. Compatibility presets and request policy

**Goal:** Provide safe defaults for reasoning, context, output, retries, tools,
and beta compatibility.

**Definition of done:**

- Compatibility, Balanced, and Maximum Reasoning presets are implemented.
- Context threshold reserves measured output/tool/reasoning headroom.
- Response headroom is enforced locally; proxy-side output enforcement is added
  only after a supported mechanism passes live compatibility testing.
- Retry policy is bounded and distinguishes permanent failures.
- Experimental betas, fine-grained tool streaming, discovery, and session
  affinity are explicit options with documented consequences.

### 12. Update, rollback, and compatibility promotion

**Goal:** Upgrade the gateway and manager without sacrificing a known-good
installation.

**Definition of done:**

- Updates stage a candidate version on a temporary endpoint.
- Health, model, token-count, stream, and tool smoke tests gate activation.
- Previous manager/config/gateway state remains recoverable.
- One-command rollback is implemented and tested after partial failures.
- Compatibility matrix and changelog updates are required for promotion.

### 13. Security hardening and audit readiness

**Goal:** Verify that credential, executable, process, and diagnostic boundaries
fail closed.

**Definition of done:**

- Owner-only permissions and umask are enforced and tested.
- Central redaction covers headers, tokens, callback URLs, and structured errors.
- Artifact allowlists, checksum verification, and path traversal protections are
  tested adversarially.
- Loopback/client-auth requirements cannot be disabled accidentally.
- Threat model and private reporting guidance match implementation.
- A focused security review produces no unresolved critical or high findings.

### 14. macOS support

**Goal:** Support managed session and persistent modes on current macOS Intel and
Apple Silicon systems.

**Definition of done:**

- Correct artifacts are selected and verified for both architectures.
- LaunchAgent install/remove/status behavior is idempotent.
- Keychain/quarantine/signing behavior is documented and tested where possible.
- Device and browser/manual OAuth paths work remotely and locally.
- Uninstall and rollback preserve explicit credential choices.

### 15. Windows session-mode support

**Goal:** Provide a reliable Windows user experience without requiring an
administrator service.

**Definition of done:**

- PowerShell/stable launcher installation and quoting are tested.
- Session-mode lifecycle handles Ctrl+C, child exit, ports, and temporary state.
- Windows credential and permission limitations are documented.
- Device OAuth, diagnostics, update, rollback, and uninstall pass smoke tests.
- No Unix-only path or process assumptions remain in shared code.

### 16. Release, marketplace, and protected live compatibility workflow

**Goal:** Ship a reproducible public release and create a safe feedback loop for
future Claude Code and gateway changes.

**Definition of done:**

- Release workflow verifies versions, changelog, tests, package allowlist, and
  compatibility metadata.
- GitHub Release contains bundles, checksums, SBOM, and provenance where
  available.
- Claude Code marketplace installation and local `--plugin-dir` smoke tests pass.
- Protected manual workflow performs bounded text/tool/compaction checks with
  redacted logs and no PR access to secrets.
- `v0.1.0` release notes clearly state supported platforms, versions, and the
  unofficial gateway boundary.
