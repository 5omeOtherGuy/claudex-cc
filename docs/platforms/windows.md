# Windows support

Claudex supports `win32-x64` and `win32-arm64` in **session mode**: every
`claudex` launch starts its own gateway on an ephemeral loopback port and
stops it when Claude Code exits. There is deliberately no Windows service —
no administrator rights are required, and Claudex never registers services,
scheduled tasks, or autoruns. A persistent-mode config falls back to session
launches on Windows.

## Launcher

Setup installs `claudex.cmd` into `%LOCALAPPDATA%\claudex\bin` (CRLF cmd
script, quoted paths, `%*` argument passthrough). It works from both
`cmd.exe` and PowerShell. Add the directory to your user `Path` once
(System Settings → Environment Variables, or
`[Environment]::SetEnvironmentVariable("Path", "$env:Path;$env:LOCALAPPDATA\claudex\bin", "User")`
in PowerShell), then start new terminals. Manager entries containing cmd
expansion characters (`%`) are refused at render time; an existing
`claudex.cmd` without the Claudex marker is never overwritten.

## Session lifecycle

- Ctrl+C: the launcher forwards the interrupt to Claude Code and never
  handles it itself; when Claude Code exits, the session gateway is stopped
  (terminate, bounded wait, then force-kill) and its temporary state file is
  removed.
- Crashed sessions leave state that is cleaned up on the next launch via
  pid-liveness checks; recorded pids are never signalled.
- Ports: each session reserves a free ephemeral loopback port first, so
  concurrent sessions and foreign listeners on the configured port cannot
  collide.

## Credential and permission limitations

- POSIX file modes are not meaningful on NTFS. The owner-only checks
  (0600/0700) that fail closed on Linux/macOS are documented no-ops on
  Windows; protection comes from the per-user profile ACLs on
  `%LOCALAPPDATA%\claudex` and `%APPDATA%\claudex`.
- Consequences: do not relocate the Claudex state directory onto a share or
  a world-readable folder, and prefer full-disk encryption (BitLocker) on
  machines with multiple users. Claudex never edits ACLs itself.
- Credentials are stored by the gateway as files under
  `%LOCALAPPDATA%\claudex\state\credentials` (ADR 0004); the Windows
  Credential Manager is not used.

## OAuth, diagnostics, update, rollback, uninstall

- Browser login is the in-product default through `/claudex:login`; device login
  remains available in an interactive terminal for headless sessions.
- `status`, `doctor`, `update` (staged, checksum-verified, smoke-gated),
  `rollback`, and `uninstall` behave as on Linux minus the service steps.
  The Windows CI portability job runs the full deterministic suite,
  including the update, rollback, and uninstall paths, on every change.
- Archives are `.zip` and are extracted with the system `tar` (bsdtar,
  available on Windows 10+); the SHA-256 pin is verified before anything is
  executed.
