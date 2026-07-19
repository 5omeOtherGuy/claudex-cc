# macOS support

Claudex supports Intel (`darwin-x64`) and Apple Silicon (`darwin-arm64`)
macOS systems in both runtime modes:

- **Persistent mode** installs a per-user LaunchAgent
  (`~/Library/LaunchAgents/com.claudex.gateway.plist`) that starts the
  gateway at login, restarts it on failure (`KeepAlive` with
  `SuccessfulExit=false`), and runs with `Umask` 63 (octal 0077) so
  everything the gateway writes stays owner-only. Install, remove, and
  status operations are idempotent; a plist without the Claudex managed
  marker, or any other LaunchAgent referencing `cli-proxy-api`, is refused,
  never overwritten.
- **Session mode** starts a gateway per `claudex` launch on an ephemeral
  loopback port, exactly like Linux.

## Artifacts

Both architectures have pinned SHA-256 hashes in the committed manifest,
transcribed from the upstream release's `checksums.txt`. The installer
verifies the checksum before anything is extracted or executed; a mismatch
installs nothing.

## Quarantine, signing, and Gatekeeper

- Claudex downloads the gateway with Node's HTTP client and extracts it with
  the system `tar`. Neither applies the `com.apple.quarantine` attribute, so
  Gatekeeper does not block the verified binary. The trust anchor is the
  pinned SHA-256, not a signature.
- The upstream CLIProxyAPI release binaries are not notarized by Claudex. If
  you download an archive manually with a browser (which does quarantine
  it), let Claudex install it instead — or remove the attribute only after
  verifying the checksum yourself.
- Claudex never runs `xattr`, `spctl`, or `codesign` on your behalf.

## Keychain

Claudex and the gateway do not use the macOS Keychain. OAuth credentials are
stored by the gateway as owner-only files under the Claudex state directory
(`~/Library/Application Support/claudex/state/credentials`), as documented
in the security model and ADR 0004. Uninstall keeps or deletes them only via
the explicit `--keep-credentials` / `--delete-credentials` choice.

## OAuth

- **Browser flow (in-product default)** opens the provider page through
  `/claudex:login`; callback material remains inside the manager process.
- **Device flow (headless fallback)** works locally and over SSH. Run the
  control CLI in an interactive terminal so its one-time URL and code never
  enter chat.
  Callback handling stays inside the login process on loopback.

## Rollback and uninstall

`claudex-pluginctl rollback` and `uninstall` behave as on Linux, with the
LaunchAgent taking the place of the systemd unit. Foreign agents and
unmanaged files are refused rather than removed, and credential retention is
always a separate explicit decision.
