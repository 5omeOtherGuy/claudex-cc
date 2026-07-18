import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "../../src/security/redaction.js";

void test("redacts bearer, API key, callback, and JSON token patterns", () => {
  const input = [
    "Authorization: Bearer abc.def.ghi",
    "key=sk-example-secret",
    "http://localhost/callback?code=abc123&state=state123",
    '{"refresh_token":"refresh-secret"}',
  ].join("\n");

  const result = redactSecrets(input);

  assert.doesNotMatch(result, /abc\.def\.ghi|sk-example-secret|abc123|state123|refresh-secret/);
  assert.match(result, /<REDACTED>/);
});
