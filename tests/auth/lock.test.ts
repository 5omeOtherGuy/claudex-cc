import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireLoginLock } from "../../src/auth/lock.js";

async function makeStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claudex-lock-"));
}

test("acquiring and releasing the login lock allows a fresh attempt", async () => {
  const stateDir = await makeStateDir();
  const first = await acquireLoginLock(stateDir, { now: () => 1_000 });
  assert.equal(first.ok, true);
  if (first.ok) {
    await first.release();
  }
  const second = await acquireLoginLock(stateDir, { now: () => 2_000 });
  assert.equal(second.ok, true);
});

test("a held lock blocks a second concurrent attempt", async () => {
  const stateDir = await makeStateDir();
  const first = await acquireLoginLock(stateDir, { now: () => 1_000 });
  assert.equal(first.ok, true);

  const second = await acquireLoginLock(stateDir, { now: () => 2_000 });
  assert.equal(second.ok, false);
  assert.ok(!second.ok && /login attempt/i.test(second.error));
});

test("a stale lock is replaced after the ttl", async () => {
  const stateDir = await makeStateDir();
  const first = await acquireLoginLock(stateDir, { now: () => 1_000, ttlMs: 500 });
  assert.equal(first.ok, true);

  const second = await acquireLoginLock(stateDir, { now: () => 2_000, ttlMs: 500 });
  assert.equal(second.ok, true);
});
