import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileValidator, inspectCredentialMetadata } from "../../src/auth/metadata.js";

async function makeCredentialsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claudex-cred-"));
  const dir = join(root, "credentials");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const FAKE_CREDENTIAL = JSON.stringify({
  type: "codex",
  access_token: "fake-access-token-value",
  refresh_token: "fake-refresh-token-value",
  expired: "2027-01-01T00:00:00Z",
  email: "person@example.invalid",
});

test("metadata reports presence and expiry without any token or account material", async () => {
  const dir = await makeCredentialsDir();
  await writeFile(join(dir, "codex-fake.json"), FAKE_CREDENTIAL, { mode: 0o600 });

  const metadata = await inspectCredentialMetadata(dir);
  assert.equal(metadata.present, true);
  assert.equal(metadata.ownerOnly, true);
  assert.equal(metadata.expiresAt, "2027-01-01T00:00:00Z");

  const serialized = JSON.stringify(metadata);
  assert.doesNotMatch(serialized, /fake-access-token|fake-refresh-token/);
  assert.doesNotMatch(serialized, /person@example/);
});

test("missing credentials report absent metadata", async () => {
  const dir = await makeCredentialsDir();
  const metadata = await inspectCredentialMetadata(dir);
  assert.equal(metadata.present, false);
});

test("the persistence check normalizes credential permissions before validation", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  const dir = await makeCredentialsDir();
  const file = join(dir, "codex-fake.json");
  await writeFile(file, FAKE_CREDENTIAL, { mode: 0o600 });
  await chmod(dir, 0o775);
  await chmod(file, 0o664);

  const validator = createFileValidator(dir, async () => ({ ok: true }));
  assert.deepEqual(await validator.checkPersisted(), { ok: true });
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("credential normalization never follows symlinks", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX symlink and permission behavior differs on Windows");
    return;
  }
  const dir = await makeCredentialsDir();
  const target = join(dir, "..", "unrelated.json");
  await writeFile(target, FAKE_CREDENTIAL, { mode: 0o644 });
  await symlink(target, join(dir, "codex-linked.json"));

  const validator = createFileValidator(dir, async () => ({ ok: true }));
  const check = await validator.checkPersisted();

  assert.equal(check.ok, false);
  assert.equal((await stat(target)).mode & 0o777, 0o644);
});

test("the file validator passes owner-only credentials and delegates the probe", async () => {
  const dir = await makeCredentialsDir();
  await writeFile(join(dir, "codex-fake.json"), FAKE_CREDENTIAL, { mode: 0o600 });

  let probed = 0;
  const validator = createFileValidator(dir, async () => {
    probed += 1;
    return { ok: true };
  });

  assert.deepEqual(await validator.checkPersisted(), { ok: true });
  assert.deepEqual(await validator.probe(), { ok: true });
  assert.equal(probed, 1);
});
