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

test("v1 configs gain the request policy and advanced options on migration", () => {
  const v1 = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  v1.configVersion = 1;
  delete v1.requests;
  delete v1.advanced;

  const result = migrateConfig(v1);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.migrated, true);
    assert.deepEqual(result.config.requests, { retries: 3 });
    assert.deepEqual(result.config.advanced, {
      sessionAffinity: false,
      streamingKeepaliveSeconds: 0,
      streamingBootstrapRetries: 0,
      remoteModelCatalog: true,
    });
  }
});
