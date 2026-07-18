import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { applyPreset, findPreset, PRESETS } from "../../src/config/presets.js";
import { validateConfig } from "../../src/config/schema.js";

test("all three required presets exist", () => {
  assert.deepEqual(
    PRESETS.map((preset) => preset.name),
    ["compatibility", "balanced", "max-reasoning"],
  );
});

test("every preset produces a config that passes validation incl. headroom", () => {
  for (const preset of PRESETS) {
    const applied = applyPreset(DEFAULT_CONFIG, preset);
    const validated = validateConfig(applied);
    assert.equal(validated.ok, true, `${preset.name}: ${JSON.stringify(validated)}`);
  }
});

test("presets only touch reasoning, context, and request policy", () => {
  const preset = findPreset("max-reasoning");
  assert.ok(preset !== undefined);
  const custom = {
    ...DEFAULT_CONFIG,
    models: { main: "custom-a", subagent: "custom-b", fallback: "custom-c" },
    runtime: { ...DEFAULT_CONFIG.runtime, mode: "session" as const },
    advanced: { ...DEFAULT_CONFIG.advanced, sessionAffinity: true },
  };
  const applied = applyPreset(custom, preset);

  assert.deepEqual(applied.models, custom.models);
  assert.deepEqual(applied.runtime, custom.runtime);
  assert.deepEqual(applied.advanced, custom.advanced);
  assert.equal(applied.reasoning.effort, "xhigh");
  assert.equal(applied.context.maxOutputTokens, 65_536);
});

test("the balanced preset matches the shipped defaults", () => {
  const preset = findPreset("balanced");
  assert.ok(preset !== undefined);
  const applied = applyPreset(DEFAULT_CONFIG, preset);
  assert.deepEqual(applied, DEFAULT_CONFIG);
});

test("unknown preset names are rejected", () => {
  assert.equal(findPreset("turbo"), undefined);
});
