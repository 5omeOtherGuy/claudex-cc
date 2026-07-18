import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { migrateConfig } from "../../src/config/migrations.js";
import { CONFIG_VERSION } from "../../src/config/schema.js";

test("unversioned scaffold config is migrated to the current version", () => {
  const legacy = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  delete legacy.configVersion;

  const result = migrateConfig(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.config.configVersion, CONFIG_VERSION);
});

test("current-version config passes through unchanged", () => {
  const result = migrateConfig(structuredClone(DEFAULT_CONFIG));
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.config, DEFAULT_CONFIG);
});

test("future config versions fail closed instead of guessing", () => {
  const future = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  future.configVersion = CONFIG_VERSION + 1;

  const result = migrateConfig(future);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("newer"));
});

test("migrated config must still pass validation", () => {
  const broken: Record<string, unknown> = { runtime: { host: "0.0.0.0" } };
  const result = migrateConfig(broken);
  assert.equal(result.ok, false);
});
