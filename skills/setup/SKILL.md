---
name: setup
description: Install and configure the managed Claudex gateway and stable launcher.
allowed-tools: Bash, AskUserQuestion
---

Run setup as a controlled installer, not as an open-ended conversation. Follow
the five phases in order. Use only concise status lines in the form
`[step/5] Action`; do not narrate reasoning, explore the CLI, or repeat completed
steps.

The control CLI is the sole source of setup behavior and supported settings.
Never duplicate its validation, invent keys or values, reinterpret a setting's
scope, modify Claude Code settings, bypass checksum verification, or claim
success that the CLI did not verify.

## 1 — Inspect

1. Say `[1/5] Checking current state.`
2. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status` and
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup --plan`.
3. Treat the returned setup plan as the complete configuration and question
   contract. Use its current values, keys, scope, allowed values, question text,
   option labels, and descriptions exactly. Do not call help, probe for other
   keys, or improvise alternatives.
4. If status already reports launch readiness, state the effective runtime,
   model assignments, and reasoning scope/value once, then skip to Phase 5.

## 2 — Configure

1. Say `[2/5] Selecting configuration.`
2. Present `plan.profile` with AskUserQuestion exactly as returned.
3. For the recommended profile, apply only the entries in
   `plan.profile.recommendedChanges` whose values differ from `plan.current`.
4. For customization, present each entry in `plan.customization` in order:
   - Use each question's returned header, question, options, and descriptions.
   - Show the relevant current value before asking.
   - For custom models, require the returned `inputFormat` and reject an answer
     that omits any returned model key.
   - For reasoning, state its returned scope and `appliesTo` roles explicitly.
     Offer only its returned options and `otherValues`. Never turn one global
     reasoning setting into per-model choices.
5. Display one compact plan of the selected keys and values. Apply only changed
   values with `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl config set <key>
   <value>`.
6. If any write fails, stop before installation and report the CLI error and
   remediation. Do not investigate the configuration surface interactively.

## 3 — Install

1. Say `[3/5] Installing Claudex.`
2. Run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl setup`.
3. Report each CLI step faithfully without speculative diagnosis. Download and
   checksum failures are terminal; never work around them.
4. If an unmanaged `claudex` launcher blocks installation, do not read or print
   its contents. Ask whether to **Back up and continue (Recommended)** or
   **Stop**. Back up only after selection, refuse to overwrite an existing
   backup, and rerun setup. Delete the launcher only after a separate, explicit
   user request.
5. Call this phase `Installation complete`, not `Setup complete`;
   authentication and compatibility verification remain.

## 4 — Authenticate

1. Say `[4/5] Authentication required.`
2. Ask for **Device login (Recommended)** or **Browser login**.
3. Tell the user to run the selected command in their own interactive terminal.
   Print the resolved absolute control-CLI path; never print the literal
   `${CLAUDE_PLUGIN_ROOT}` and never instruct them to run bare
   `claudex-pluginctl`:
   - Device: `<absolute-control-cli-path> login`
   - Browser: `<absolute-control-cli-path> login --browser`
4. Do not run login, capture its output, or request codes, authorization URLs,
   callback URLs, tokens, credential filenames, or account identifiers. Ask the
   user to reply only `done` or `failed`, without pasting terminal output.
5. After `done`, run `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl status`. Do not
   claim authentication succeeded unless status confirms owner-only credentials
   and launch readiness.

## 5 — Verify and hand off

1. Say `[5/5] Verifying compatibility.`
2. Ask whether to run one minimal billed inference with
   `${CLAUDE_PLUGIN_ROOT}/bin/claudex-pluginctl doctor --allow-live-inference`.
   Recommend it, explain that it verifies the real request path, and never run it
   without explicit consent.
3. If live inference fails, state that Claudex is not verified, report the CLI
   remediation, and do not direct the user to launch.
4. If it passes, say `Claudex setup verified.` If the user declines, say
   `Installation and authentication complete; inference was not verified.`
5. Explain the session boundary once: this running Claude Code session keeps its
   current provider. Confirm that the launcher directory is on PATH, then direct
   the user to start a new session with `claudex`.
