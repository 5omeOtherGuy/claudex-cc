# Release checklist

Every release is user-triggered; automation verifies and packages, humans
decide. The release workflow fails closed on any metadata mismatch.

## Before tagging

1. Move the `## [Unreleased]` changelog entries into a `## [X.Y.Z]` section
   with the release date, and keep an empty Unreleased section.
2. Bump the version in `package.json`, `.claude-plugin/plugin.json`, and
   `src/version.ts` (all three must match; CI enforces it).
3. If the gateway pin changed, `docs/compatibility-matrix.md` and
   `CHANGELOG.md` must document the new release
   (`tests/release/promotion.test.ts` enforces it), and a protected
   live-compatibility run must have passed for the new combination.
4. `npm run check` and `node scripts/verify-release.mjs` pass locally.

## Manual smoke (maintainer machine)

1. `npm pack`, extract the tarball, and start Claude Code with
   `claude --plugin-dir <extracted>/package` — the `/claudex:*` skills must
   load, and `claudex-pluginctl status` must run from the packed content.
2. Optional but recommended: a fresh-`HOME` end-to-end `setup` → `login` →
   `claudex` run on the primary platform.

## Tag and publish

1. `git tag vX.Y.Z && git push origin vX.Y.Z` — the release workflow builds
   the tarball, verifies versions/changelog/allowlist/compatibility
   metadata, generates `SHA256SUMS.txt` and a CycloneDX SBOM, attests build
   provenance, and creates the GitHub release with generated notes (support
   matrix and the unofficial-gateway boundary statement are always
   included).
2. Publish the marketplace entry pointing at the released tarball/commit.
3. Verify a marketplace installation on a clean machine before announcing.

## Protected live compatibility runs

The `Live compatibility (protected)` workflow is manual-only and runs in the
`live-compatibility` environment — create that environment in the repository
settings with required reviewers, and store `CODEX_AUTH_JSON` (one gateway
credential file's content) as an environment secret. Runs are bounded
(health, inventory, token counting, compaction-scale counting; stream/tool
checks with `max_tokens: 8` only when explicitly enabled) and print only
redacted statuses.
