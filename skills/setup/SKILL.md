---
name: setup
description: Preflight, configure, install, authenticate, and verify Claudex.
allowed-tools: Bash, AskUserQuestion
---

Run setup as a controlled installer. Follow the five phases in order. Use only
concise status lines in the form `[step/5] Action`; do not narrate reasoning,
explore the CLI, or repeat completed steps.

The control CLI is the sole source of setup behavior, diagnostics, and supported
settings. Never invent keys or values, reinterpret scope, modify Claude Code
settings, bypass security checks, or claim success that code did not verify.

## 1 — Preflight

1. Say `[1/5] Running setup preflight.`
2. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`,
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup --plan`, and
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup --preflight`.
3. Treat the plan as the complete configuration/question contract. Treat the
   preflight report as authoritative; do not reproduce its checks in shell.
4. Resolve every failed preflight check before continuing:
   - For a foreign launcher, do not inspect or print its contents. Ask whether to
     **Back up and continue (Recommended)** or **Stop**. After approval, rename
     it to a non-existing backup path and rerun preflight. Delete it only after a
     separate explicit request.
   - For configuration or platform failures, report the supplied remediation
     and stop.
5. Report preflight warnings before configuration. Never modify global Claude
   settings. If a warning says they can shadow Claudex routing, ask whether to
   continue with that known conflict or stop.
6. If status already reports launch readiness, state the effective runtime,
   model assignments, and reasoning scope/value once, then skip to Phase 5.

## 2 — Configure

1. Say `[2/5] Selecting configuration.`
2. Present `plan.profile` with AskUserQuestion exactly as returned.
3. For the recommended profile, apply only returned `recommendedChanges` whose
   values differ from `plan.current`.
4. For customization, present each `plan.customization` entry in order. Use its
   exact header, question, options, descriptions, current value, and allowed
   values. Require the returned format for custom models. For reasoning, state
   the returned scope and affected roles; never convert one global setting into
   per-model choices.
5. Display one compact change plan. Apply only changed values with
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl config set <key> <value>`.
6. Stop before installation if any write fails; relay the CLI remediation
   without interactive capability discovery.

## 3 — Install

1. Say `[3/5] Installing Claudex.`
2. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup`.
3. Report each CLI step faithfully. Never work around download, checksum,
   permission, or service failures.
4. Call this phase `Installation complete`, not `Setup complete`;
   authentication and compatibility verification remain.

## 4 — Authenticate

1. If status already confirmed owner-only credentials and launch readiness, skip
   this phase.
2. Say `[4/5] Opening secure browser sign-in.` Run
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl login --browser` yourself and
   allow at least six minutes for completion. The manager opens the browser,
   waits for the callback, normalizes credential permissions, and validates an
   authenticated request.
3. Never print or request authorization URLs, callback URLs, device codes,
   tokens, credential filenames, account identifiers, or raw headers. Relay only
   redacted manager progress and its final result.
4. If no browser/callback is available, offer **Retry browser login
   (Recommended)**, **Use device login**, or **Stop**. Run browser retries
   yourself. Device login alone must run in the user's interactive terminal so
   its one-time code never enters chat; provide the resolved absolute command,
   never bare `claudex-pluginctl`.
5. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. Continue only when
   owner-only credentials and launch readiness are confirmed.

## 5 — Verify and hand off

1. Say `[5/5] Verifying end-to-end compatibility.`
2. Ask for consent to run one minimal billed inference with
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl doctor --allow-live-inference`.
   Recommend it and never run it without explicit consent.
3. If it fails, state that Claudex is not verified, relay the classified
   remediation, and do not direct the user to launch.
4. If it passes, say `Claudex setup verified.` If declined, say
   `Installation and authentication complete; inference was not verified.`
5. State the session boundary once: this running session keeps its provider.
   Confirm the launcher directory is on PATH, then direct the user to start a
   new session with `claudex`.
