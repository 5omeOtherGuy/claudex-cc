# Troubleshooting

Always start with:

```bash
claudex-pluginctl status          # readiness ladder, drift, session guidance
claudex-pluginctl doctor --offline
```

Doctor exit code 1 means "problems were diagnosed", not that doctor failed;
every failing check prints its remediation. Diagnostics are redacted by
design — no tokens, callback URLs, or account identifiers appear in output.

## Launch is blocked

The readiness ladder fails closed in order:

- `gateway_missing` — no activated gateway. Run `/claudex:setup` (or
  `claudex-pluginctl setup`).
- `not_logged_in` — no Codex credentials. Run `claudex-pluginctl login` in
  an interactive terminal; success requires both persisted owner-only
  credentials and an authenticated probe.
- `gateway_unhealthy` (persistent mode) — the service did not answer.
  Check `systemctl --user status claudex-gateway` (Linux) or
  `launchctl print gui/$UID/com.claudex.gateway` (macOS), then run doctor.
  `claudex-pluginctl setup` rewrites the service safely.

## Login problems

- `locked` — another login attempt is active; a crashed attempt unlocks
  automatically after 15 minutes.
- `denied` / `entitlement` — the provider rejected the request or the
  account lacks Codex access; retry after checking the subscription.
- `persistence` / `validation` — the flow finished but credentials were not
  stored owner-only, or the authenticated probe failed. Run doctor, then
  login again. Never paste codes, URLs, or tokens into chat.

## Session runs on the wrong provider

`status` prints a `session:` line. A session started with plain `claude`
keeps its provider — that is by design; start a new session with `claudex`.
If `claudex` is not found, ensure the launcher directory is on `PATH`
(`~/.local/bin`, or `%LOCALAPPDATA%\claudex\bin` on Windows).

## Update or rollback trouble

- Updates stage the candidate on a temporary endpoint first; a failed smoke
  check aborts before anything changes. A smoke failure mentioning missing
  models or `count_tokens` usually means the system is not logged in.
- After a bad update, `claudex-pluginctl rollback` reactivates the previous
  version in one command; if its health check also fails, run doctor before
  launching.

## Drift warnings in status

`drift:` lines name version skew between the active gateway, the config
pin, and the shipped manifest; run the suggested command (`setup` or
`update`) instead of editing files manually. `config reset` restores
defaults and keeps a backup.

## Conflicting global Claude settings

Doctor diagnoses (read-only, never modifies) global Claude Code settings
that pin `model` or `ANTHROPIC_*` env vars — those override the per-session
gateway environment. Remove them from `~/.claude/settings.json` yourself if
you want `claudex` sessions to win.

## Port conflicts

Persistent mode binds the configured loopback port (default 8317); a
`port_conflict` failure names the conflicting behavior. Session launches
always use a free ephemeral port and cannot conflict. Foreign CLIProxyAPI
installations are never touched — if you run your own, either keep Claudex
in session mode or give it a different `runtime.port`.

If a problem persists, file an issue with the redacted `doctor --json`
output. Never include credential files, callback URLs, or raw headers.
