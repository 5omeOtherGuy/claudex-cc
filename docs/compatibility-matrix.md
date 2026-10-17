# Compatibility matrix

| Claude Code | Claudex | Gateway | Models | Status | Notes |
|---|---|---|---|---|---|
| 2.1.214 | 0.1.0 (in development) | CLIProxyAPI 8.0.32 | Sol/Terra/Luna catalog | Staged verification implemented | Live promotion run pending; deterministic smoke gates (health, inventory, token count) verified; credential-free interface review against 7.2.86 below |
| 2.1.214 | 0.1.0 (in development) | CLIProxyAPI 7.2.86 | Sol/Terra/Luna catalog | Superseded pin | Live promotion run was never completed; kept as the rollback target for existing installs |

## Gateway 7.2.86 → 8.0.32 review (2026-10-17)

CLIProxyAPI 8 is a new major. The review compared the upstream release notes
from 7.2.87 through 8.0.32 and the upstream source at `81d70f5d` (7.2.86) and
`911f49cb` (8.0.32) for every surface Claudex depends on, and ran the 8.0.32
Linux binary with the configuration Claudex renders (fake client secret, no
credentials, no inference).

| Surface Claudex uses | Result |
|---|---|
| Release asset names and archive layout | Unchanged for the six pinned platforms; the binary is still `cli-proxy-api` (`.exe` on Windows) at the archive root. Claudex does not use the `_no-plugin` assets that both releases also publish. |
| Configuration keys written by `src/lifecycle/cliproxy.ts` | 8.x introduces a new layout (`server.host`, `access.api-keys`, `requests.payload`, …) but still loads the legacy keys Claudex writes with their old meaning; the root `api-keys` list stays the client-key list (only a mapping is read as v8 provider groups). The rendered legacy-only file was not modified at startup. |
| CLI flags (`--config`, `--local-model`, `--codex-login`, `--codex-device-login`, `--no-browser`) | Unchanged. |
| Login output parsed by `src/auth/cliproxy-driver.ts` | Every matched line is unchanged. Credential files keep the `expired` field Claudex reads. |
| Endpoints used by `src/gateway/smoke.ts` (`/v1/models`, `/v1/messages/count_tokens`, `/v1/messages`) | Unchanged. Without a client key `/v1/models` answers 401; with it, 200. Management and the control panel answer 404. |
| Loopback binding | Listens only on the configured `127.0.0.1` port; LAN discovery (mDNS, new in 8.x), pprof, and dynamic plugins are off by default and not enabled by Claudex. Management stays disabled as long as `MANAGEMENT_PASSWORD` is not set in the gateway's environment (unchanged from 7.2.86). |
| Outbound requests | 8.x adds a background Grok CLI version lookup against the npm registry at startup and every three hours, even without xAI credentials and with `--local-model`. It sends no credentials or prompts and downloads metadata only. 7.2.86 already made the Antigravity version check and, without `--local-model`, the model catalog fetches. |

Behaviour changes that do not break Claudex but matter to users:

- Codex credential files are now named with an account hash
  (`codex-<hash>-<email>-<plan>.json`). Logging in again after the upgrade can
  leave a second file for the same account next to the 7.2.86 one; remove the
  older file if the gateway reports refresh failures.
- Credentials are refreshed one day before expiry instead of five.
- An unknown model on `count_tokens` returns 400 instead of 502; Claudex treats
  both as a failed check.
- The Pro plan catalog now advertises a 921,000-token context window for the
  GPT-5.6 models; the Claudex default of 372,000 stays within the window every
  plan advertises for the GPT-5.6 models it offers.

## Promotion gate

A combination is supported only after it passes:

- streamed text response
- client tool cycle
- parallel tool calls
- subagent request
- image input
- long-session compaction
- interrupted request and retry
- authentication refresh path
- first-token and terminal-event checks
- redacted diagnostic collection

Default CI covers deterministic fixtures. Live promotion tests run manually in a
protected environment with bounded usage and no secret-bearing logs. No live
promotion run has passed yet for any gateway pin.
