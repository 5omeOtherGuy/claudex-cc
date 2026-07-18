import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activateGatewayVersion,
  getActiveGateway,
  rollbackGatewayActivation,
} from "../../src/gateway/activate.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-act-"));
  const configDir = join(root, "config");
  const stateDir = join(root, "state");
  return {
    configDir,
    configFile: join(configDir, "config.json"),
    configBackupFile: join(configDir, "config.json.bak"),
    dataDir: join(root, "data"),
    stateDir,
    credentialsDir: join(stateDir, "credentials"),
  };
}

async function installFakeVersion(paths: ClaudexPaths, version: string): Promise<void> {
  const dir = join(paths.dataDir, "gateway", "versions", version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "cli-proxy-api"), `binary-${version}`, { mode: 0o755 });
}

test("activation points the active pointer at an installed version", async () => {
  const paths = await makePaths();
  await installFakeVersion(paths, "1.0.0");

  const result = await activateGatewayVersion(paths, "1.0.0", "cli-proxy-api");
  assert.equal(result.ok, true);

  const active = await getActiveGateway(paths);
  assert.ok(active !== undefined);
  assert.equal(active.version, "1.0.0");
  assert.match(active.binaryFile, /1\.0\.0[/\\]cli-proxy-api$/);
});

test("activating a missing version fails closed and keeps the previous pointer", async () => {
  const paths = await makePaths();
  await installFakeVersion(paths, "1.0.0");
  await activateGatewayVersion(paths, "1.0.0", "cli-proxy-api");

  const result = await activateGatewayVersion(paths, "9.9.9", "cli-proxy-api");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("9.9.9"));

  const active = await getActiveGateway(paths);
  assert.equal(active?.version, "1.0.0");
});

test("rollback restores the previously active version without redownloading", async () => {
  const paths = await makePaths();
  await installFakeVersion(paths, "1.0.0");
  await installFakeVersion(paths, "1.1.0");
  await activateGatewayVersion(paths, "1.0.0", "cli-proxy-api");
  await activateGatewayVersion(paths, "1.1.0", "cli-proxy-api");

  const rollback = await rollbackGatewayActivation(paths);
  assert.equal(rollback.ok, true);
  assert.equal((await getActiveGateway(paths))?.version, "1.0.0");
});

test("rollback without a previous activation fails closed", async () => {
  const paths = await makePaths();
  const rollback = await rollbackGatewayActivation(paths);
  assert.equal(rollback.ok, false);
});

test("no pointer means no active gateway", async () => {
  const paths = await makePaths();
  assert.equal(await getActiveGateway(paths), undefined);
});
