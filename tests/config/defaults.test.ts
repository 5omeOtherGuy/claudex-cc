import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

void test("default gateway is loopback-only and context reserves headroom", () => {
  assert.equal(DEFAULT_CONFIG.runtime.host, "127.0.0.1");
  assert.ok(DEFAULT_CONFIG.context.compactAt < DEFAULT_CONFIG.context.advertisedWindow);
  assert.ok(
    DEFAULT_CONFIG.context.compactAt + DEFAULT_CONFIG.context.maxOutputTokens <
      DEFAULT_CONFIG.context.advertisedWindow,
  );
});
