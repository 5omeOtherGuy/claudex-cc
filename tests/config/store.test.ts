import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { loadConfig, saveConfig } from "../../src/config/store.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-store-"));
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

test("loading without a config file returns defaults without creating files", async () => {
  const paths = await makePaths();
  const result = await loadConfig(paths);

  assert.equal(result.ok, true);
  assert.ok(result.ok && result.source === "defaults");
  assert.deepEqual(result.ok && result.config, DEFAULT_CONFIG);
  await assert.rejects(stat(paths.configFile));
});

test("save then load round-trips and enforces owner-only permissions", async (t) => {
  const paths = await makePaths();
  await saveConfig(paths, DEFAULT_CONFIG);

  const result = await loadConfig(paths);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.config, DEFAULT_CONFIG);
  assert.ok(result.ok && result.source === "file");

  if (process.platform === "win32") {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  const dirMode = (await stat(paths.configDir)).mode & 0o777;
  const fileMode = (await stat(paths.configFile)).mode & 0o777;
  assert.equal(dirMode, 0o700);
  assert.equal(fileMode, 0o600);
});

test("saving over an existing config retains the previous version as backup", async () => {
  const paths = await makePaths();
  await saveConfig(paths, DEFAULT_CONFIG);
  const updated = { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, port: 9000 } };
  await saveConfig(paths, updated);

  const current = JSON.parse(await readFile(paths.configFile, "utf8")) as {
    runtime: { port: number };
  };
  const backup = JSON.parse(await readFile(paths.configBackupFile, "utf8")) as {
    runtime: { port: number };
  };
  assert.equal(current.runtime.port, 9000);
  assert.equal(backup.runtime.port, DEFAULT_CONFIG.runtime.port);

  const leftovers = (await readdir(paths.configDir)).filter((name) => name.includes(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("saving an invalid config fails closed without touching the file", async () => {
  const paths = await makePaths();
  await saveConfig(paths, DEFAULT_CONFIG);
  const invalid = {
    ...DEFAULT_CONFIG,
    runtime: { ...DEFAULT_CONFIG.runtime, host: "0.0.0.0" },
  };

  await assert.rejects(saveConfig(paths, invalid), /loopback/i);
  const onDisk = JSON.parse(await readFile(paths.configFile, "utf8")) as {
    runtime: { host: string };
  };
  assert.equal(onDisk.runtime.host, DEFAULT_CONFIG.runtime.host);
});

test("corrupt JSON fails closed with a recovery hint", async () => {
  const paths = await makePaths();
  await saveConfig(paths, DEFAULT_CONFIG);
  await writeFile(paths.configFile, "{ not json", "utf8");

  const result = await loadConfig(paths);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /config\.json\.bak|config reset/i.test(result.error));
});

test("unversioned config files are migrated on load", async () => {
  const paths = await makePaths();
  await saveConfig(paths, DEFAULT_CONFIG);
  const legacy = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  delete legacy.configVersion;
  await writeFile(paths.configFile, JSON.stringify(legacy), "utf8");

  const result = await loadConfig(paths);
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.migrated);
  assert.equal(result.ok && result.config.configVersion, DEFAULT_CONFIG.configVersion);
});
