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
