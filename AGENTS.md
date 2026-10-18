# Claudex contributor instructions

## Profile
- Purpose: Claude Code plugin and launcher that runs Codex models through a managed localhost gateway
- Stage: pre-release (repository standard 2026-10-18)
- Gate: `npm run check` (CI job `gate`)
- Landing: PR, squash-merged on a green gate; agents land: yes
- Release: tag-triggered release workflow (`.github/workflows/release.yml`); agents release: no
- Outside issues and PRs: agents triage; outside PRs merge: owner approves
- Sensitive paths: `src/auth/`, `src/security/`, `src/gateway/`, `src/lifecycle/`, `src/launcher/`, `src/config/`, `src/commands/`, `src/cli.ts`, `bin/`, `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `scripts/`, `package.json`, `package-lock.json`, `.github/`, `.githooks/`, `.agents/`, `.claude/`, `AGENTS.md`

Deliberate deviations from the standard:

- Every change lands through one worktree, one branch and one squash-merged
  PR per issue, which is stricter than pre-release trunk landing. The Amp ship
  behaviour is therefore `Push to Branch`, and `.githooks/pre-push` refuses
  direct pushes to `main`.
- A new gateway or translator needs an approved ADR (see Product boundary).
- The security invariants and the verification-by-change-type rules below,
  the ignored `.internal/` directory, and compatibility-matrix updates
  (`CONTRIBUTING.md`) are repository-specific additions.

## Map

- `src/`: the control CLI (`src/cli.ts`, `src/commands/`), gateway manifest
  and install (`src/gateway/`), lifecycle (`src/lifecycle/`), platform paths
  (`src/platform/`), auth (`src/auth/`), security helpers (`src/security/`).
- `skills/`, `agents/`, `hooks/`, `.claude-plugin/`, `bin/`: the plugin surface.
- `tests/`: deterministic `node:test` suites mirroring `src/`.
- `docs/`: architecture, ADRs, compatibility matrix, release checklist.
- `scripts/`: gate helpers, release checks, worktree tooling.
- One test file: `node --test --import tsx tests/gateway/manifest.test.ts`.
- Orbs run `.agents/setup`; other checkouts enable the hooks once with
  `git config core.hooksPath .githooks`.

## Product boundary

Claudex is a Claude Code plugin plus a stable pre-launch manager for a pinned,
localhost-only Anthropic-compatible gateway. Claude Code plugins cannot register
a primary model provider or change the parent process environment after startup.
Do not design around undocumented transport interception.

The initial gateway is managed CLIProxyAPI. Do not build a new protocol
translator unless an approved ADR establishes a measured need.

## Security invariants

- Never commit or print OAuth tokens, API keys, callback URLs, authorization
  codes, account identifiers, credential files, prompt payloads, or raw headers.
- Tests use fake credentials, temporary roots, mocked HTTP/process boundaries,
  and deterministic clocks. Default CI never performs live inference or OAuth.
- Gateway and credential directories must fail closed to owner-only permissions.
- Bind local services to loopback by default. Remote exposure requires a separate
  reviewed design.
- Downloaded executables require a pinned version and verified checksum before
  execution.
- Errors and diagnostics must pass through central redaction helpers.

## Development workflow

- The primary checkout is control-only after the bootstrap commit. Implement
  issues in a dedicated worktree branched from `origin/main`.
- Run `npm run preflight` before creating a worktree.
- Use one branch and one pull request per issue.
- Prefer branch names `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or
  `docs/<issue>-<slug>`.
- Run `npm run check` before opening or updating a pull request.
- A pull request that changes a sensitive path (see Profile), or alters
  security-sensitive behavior or rules elsewhere, needs an independent review
  (another agent or the owner) recorded on the PR against its head commit
  before merge; a later push needs a new review.
- Use squash merge. Remove merged worktrees with
  `npm run cleanup:worktree -- <path> [branch]`.

## Code conventions

- Node.js 22.19+ and strict TypeScript ESM with NodeNext resolution.
- Keep runtime dependencies minimal; prefer Node built-ins.
- Keep platform-specific behavior behind `src/platform/` and lifecycle behavior
  behind `src/lifecycle/`.
- Skills call the deterministic control CLI. Do not duplicate business logic in
  prompt files or shell snippets.
- Product configuration writes are validated, atomic, and rollback-capable.
- Match existing naming and comment density. Add comments only for non-obvious
  constraints or security boundaries.

## Verification by change type

- Behavior change: deterministic tests plus `npm run check`.
- Security boundary: regression test that fails before the fix.
- Plugin surface: `npm run plugin:validate` and a local `--plugin-dir` smoke test.
- Packaging/update code: checksum, allowlist, rollback, and failure-path tests.
- Documentation-only change: lint plus link/path checks where applicable.

## Public repository hygiene

The `.internal/` directory is ignored and may contain machine-specific research.
Never copy private paths, transcripts, account details, or local service secrets
into tracked files. Public architecture documents must describe generic paths and
redacted examples only.
