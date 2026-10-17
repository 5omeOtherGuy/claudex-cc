# Contributing

## Ground rules

- Never commit credentials, OAuth tokens, API keys, callback URLs, account
  identifiers, prompt payloads, or raw authorization headers.
- Default tests are deterministic and offline. Use fake tokens, temporary roots,
  and mocked network/process boundaries.
- Keep one issue, one worktree, and one pull request per concern.
- Do not add a new gateway implementation without an approved ADR.

## Requirements

- Node.js 22.19 or newer
- npm
- Git and GitHub CLI for the worktree helpers

## Setup

```bash
git clone https://github.com/5omeOtherGuy/claudex-cc.git
cd claudex-cc
npm ci
git config core.hooksPath .githooks
npm run check
```

The `pre-push` hook in `.githooks/` runs `npm run check` before every push and
refuses direct pushes to `main`. In an Amp orb, `.agents/setup` installs the
locked dependencies and enables the hook.

## Worktree workflow

The primary checkout is control-only after repository bootstrap.

```bash
npm run preflight
git worktree add ../claudex-cc-123 -b feat/123-short-name origin/main
cd ../claudex-cc-123
npm ci
```

Before opening a pull request:

```bash
npm run check
```

After squash merge, run from outside the worktree:

```bash
npm run cleanup:worktree -- ../claudex-cc-123 feat/123-short-name
```

The cleanup helper fails closed unless it can verify a merged pull request, or
unless `--force` is explicitly provided.

## Pull requests

- Explain the user-visible goal and the security/compatibility impact.
- Link the issue being implemented.
- Add deterministic tests for behavior changes.
- Update the changelog for user-visible changes.
- Update the compatibility matrix when changing Claude Code or gateway support.
- Keep generated artifacts and credentials out of commits.

## Verification

`npm run check` is the gate. It runs formatting/lint checks, a secret scan,
TypeScript validation, deterministic tests, a production build, plugin structure
validation, and a package dry run. CI runs the same command in the `gate` job.

Live OAuth and model calls are never part of normal CI. A future protected manual
workflow will own bounded compatibility smoke tests.
