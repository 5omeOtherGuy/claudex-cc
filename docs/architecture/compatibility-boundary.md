# Compatibility boundary

Anthropic documents gateways for Claude models and does not support routing
Claude Code to non-Claude models. Claudex is therefore an unofficial
compatibility product, not a supported Claude Code provider.

## Required gateway surface

- `POST /v1/messages`, including requests with `?beta=true`
- incremental Anthropic-compatible server-sent events
- client tools, parallel calls, tool results, and stable call identifiers
- top-level ordered system content
- reasoning/effort approximation and opaque replay
- base64 image input used by Claude Code
- Anthropic-shaped errors with useful upstream detail
- optional but important `/v1/messages/count_tokens`
- health and model inventory endpoints

## Known semantic differences

- Anthropic thinking and OpenAI reasoning are not identical.
- Anthropic cache directives and accounting are not preserved exactly.
- context-management and beta tool fields may be dropped or approximated.
- token counting is an estimate.
- output limits may require proxy-side enforcement.
- model inventory does not guarantee account entitlement.
- gateway updates and Claude Code updates can break compatibility independently.

## Request policy and explicit options

Claudex renders these validated configuration values into the gateway
configuration of the pinned release:

- **Presets** — `config preset compatibility | balanced | max-reasoning`
  bundle reasoning effort, context thresholds, output cap, and retry policy.
  Presets never touch models, runtime mode, or advanced options.
- **Context headroom** — validation enforces
  `compactAt + maxOutputTokens + 8192 (tool/reasoning reserve) < advertisedWindow`,
  so compaction always fires with room for a full response plus tool results
  and reasoning traces.
- **Proxy-side output cap** — `context.maxOutputTokens` is enforced by the
  gateway itself through an upstream `payload.override` rule
  (`max_output_tokens` on the Codex protocol), together with
  `reasoning.effort`. Clients cannot exceed the cap by asking for more.
- **Bounded retries** — `requests.retries` maps to the gateway's
  `request-retry`, which retries only transient upstream failures
  (403/408/500/502/503/504). Permanent failures (validation and
  authentication errors) surface immediately and are never retried.

### Advanced options (explicit opt-in, documented consequences)

- `advanced.sessionAffinity` — sticky credential routing per client session
  (gateway `routing.session-affinity`). Only relevant with multiple
  credentials; keeps a session pinned to one account until the TTL expires.
- `advanced.streamingKeepaliveSeconds` — SSE keep-alive interval
  (`streaming.keepalive-seconds`). Helps long-idle streams through
  aggressive proxies; some clients may log the extra keep-alive events.
- `advanced.streamingBootstrapRetries` — gateway retries before the first
  streamed byte (`streaming.bootstrap-retries`). Safe for idempotent
  requests; increases latency on failing upstreams.
- `advanced.remoteModelCatalog` — `false` starts the gateway with
  `--local-model`: only the embedded model catalog is used and no remote
  model discovery happens. More deterministic, but newly released models do
  not appear until the gateway is updated.

### Experimental betas and fine-grained tool streaming

Claude Code negotiates Anthropic beta features (for example fine-grained
tool streaming) via `anthropic-beta` headers. The protocol translation of
the gateway consumes these headers; beta semantics are not forwarded to the
Codex upstream. Claudex deliberately provides no configuration to inject
additional beta headers: Claude Code documents no environment variable for
custom headers, and silently dropped betas would be indistinguishable from
working ones. Expect beta-gated behavior to be absent through the gateway.

## Initial compatibility baseline

- Claude Code 2.1.214
- CLIProxyAPI 7.2.86 (`81d70f5d`)
- OAuth catalog context treated as 372,000 tokens
- conservative compaction target around 230,000 tokens
- proxy-side maximum output target 32,768 tokens
- `gpt-5.6-sol` main model and `gpt-5.6-luna` subagent default

These values are implementation starting points, not permanent upstream
contracts. Promotion of a new combination requires deterministic contract tests
and a protected live smoke test.
