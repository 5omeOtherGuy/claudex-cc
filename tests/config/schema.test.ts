import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { CONFIG_VERSION, validateConfig } from "../../src/config/schema.js";

function validConfig(): Record<string, unknown> {
  return structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
}

test("default config validates against the current schema version", () => {
  const result = validateConfig(DEFAULT_CONFIG);
  assert.equal(result.ok, true);
  assert.equal(DEFAULT_CONFIG.configVersion, CONFIG_VERSION);
});

test("non-object input fails with an actionable error", () => {
  const result = validateConfig("not a config");
  assert.equal(result.ok, false);
  assert.ok(result.errors[0]?.message.includes("JSON object"));
});

test("non-loopback host fails closed", () => {
  const config = validConfig();
  (config.runtime as Record<string, unknown>).host = "0.0.0.0";
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const error = result.errors.find((entry) => entry.path === "runtime.host");
  assert.ok(error, "expected a runtime.host error");
  assert.match(error.message, /loopback/i);
});

test("loopback variants are accepted", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "::1", "localhost"]) {
    const config = validConfig();
    (config.runtime as Record<string, unknown>).host = host;
    assert.equal(validateConfig(config).ok, true, `expected ${host} to validate`);
  }
});

test("out-of-range or non-integer port fails closed", () => {
  for (const port of [0, 65_536, 1.5, "8317"]) {
    const config = validConfig();
    (config.runtime as Record<string, unknown>).port = port;
    assert.equal(validateConfig(config).ok, false, `expected port ${String(port)} to fail`);
  }
});

test("context without compaction headroom fails closed", () => {
  const config = validConfig();
  (config.context as Record<string, unknown>).compactAt = 372_000;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const error = result.errors.find((entry) => entry.path === "context.compactAt");
  assert.ok(error, "expected a context.compactAt error");
});

test("context where compaction plus output exceeds the window fails closed", () => {
  const config = validConfig();
  (config.context as Record<string, unknown>).maxOutputTokens = 372_000;
  assert.equal(validateConfig(config).ok, false);
});

test("secret-like keys fail closed anywhere in the config", () => {
  for (const key of ["apiKey", "refresh_token", "clientSecret", "password"]) {
    const config = validConfig();
    (config.gateway as Record<string, unknown>)[key] = "value";
    const result = validateConfig(config);
    assert.equal(result.ok, false, `expected key ${key} to fail`);
    assert.ok(
      result.ok === false &&
        result.errors.some((entry) => entry.message.toLowerCase().includes("secret")),
    );
  }
});

test("unknown keys fail closed with the offending path", () => {
  const config = validConfig();
  config.extra = true;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.path === "extra"));
});

test("unsupported enum values report the allowed alternatives", () => {
  const config = validConfig();
  (config.runtime as Record<string, unknown>).mode = "daemon";
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const error = result.errors.find((entry) => entry.path === "runtime.mode");
  assert.ok(error, "expected a runtime.mode error");
  assert.ok(error.message.includes("persistent"), "message should list allowed values");
});

test("wrong config version is rejected by validation", () => {
  const config = validConfig();
  config.configVersion = CONFIG_VERSION + 1;
  assert.equal(validateConfig(config).ok, false);
});

test("headroom rule reserves tool and reasoning tokens beyond the output budget", () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as {
    context: { advertisedWindow: number; compactAt: number; maxOutputTokens: number };
  };
  // Would pass the naive compactAt+maxOutput check but violates the reserve.
  config.context = { advertisedWindow: 100_000, compactAt: 90_000, maxOutputTokens: 8_000 };
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((entry) => entry.message.includes("reserve")));
});

test("request retries are bounded", () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as {
    requests: { retries: number };
  };
  config.requests.retries = 99;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((entry) => entry.path === "requests.retries"));
});

test("advanced options validate types and bounds", () => {
  const config = structuredClone(DEFAULT_CONFIG) as unknown as {
    advanced: Record<string, unknown>;
  };
  config.advanced.sessionAffinity = "yes";
  config.advanced.streamingKeepaliveSeconds = -1;
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((entry) => entry.path === "advanced.sessionAffinity"));
    assert.ok(result.errors.some((entry) => entry.path === "advanced.streamingKeepaliveSeconds"));
  }
});
