# Claudex contributor instructions

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
