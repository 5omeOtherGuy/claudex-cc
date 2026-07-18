# Technology stack

## Decision

Claudex is a single repository containing a Claude Code plugin and a stable
pre-launch manager. The plugin and manager version together because their
configuration schema and compatibility behavior are coupled.

## Manager and plugin control plane

- **Runtime:** Node.js 22.19 or newer
- **Language:** strict TypeScript
- **Modules:** ESM with NodeNext resolution
- **Package manager:** npm with a committed lockfile
- **Build:** TypeScript compiler to portable JavaScript
- **Tests:** `node:test` with `tsx` for deterministic source tests
- **Lint and format:** Biome
- **Runtime dependencies:** Node built-ins first; additions require a concrete
  maintenance or security justification

Node owns installation, configuration, checksums, process management,
diagnostics, launch environment, update/rollback, and plugin-facing commands.
It does not implement the model protocol translator in the MVP.

## Gateway data plane

The initial gateway is a pinned upstream CLIProxyAPI release downloaded for the
current OS and architecture and verified against a committed SHA-256 manifest.
The manager stores versions side by side and activates one atomically.

A new or forked translator is deferred until measured evidence shows that the
upstream gateway is the dominant security or maintenance problem.

## Storage

- JSON configuration to avoid a runtime parser dependency
- owner-only user configuration and state directories
- versioned binary directories with an atomic `current` pointer
- provider-owned OAuth credential storage
- no credentials in repository, project settings, prompts, or diagnostics

## Platform support

- Linux persistent and session modes first
- macOS LaunchAgent and session modes second
- Windows session mode before optional persistent service integration
- path, argument, and offline-doctor tests run on all three platforms from the
  beginning

## Automation

- GitHub Actions for Node 22 and 24 on Ubuntu
- portability smoke tests on macOS and Windows
- CodeQL, dependency review, and Dependabot
- default CI is offline and deterministic
- live OAuth/model smoke tests are manual, protected, and added only after the
  local manager is safe

## Distribution

- public GitHub repository and Claude Code plugin marketplace source
- GitHub Release bundles and checksums
- no npm publication requirement for the MVP
- upstream CLIProxyAPI assets remain upstream initially; Claudex downloads a
  pinned asset rather than rehosting every binary
