import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runConfigCommand } from "../../src/commands/config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-cli-"));
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

test("config show prints the effective config as JSON", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["show", "--json"], paths);

  assert.equal(result.exitCode, 0);
  const printed = JSON.parse(result.output) as typeof DEFAULT_CONFIG;
  assert.deepEqual(printed, DEFAULT_CONFIG);
});

test("config show without --json is human-readable and mentions the source", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["show"], paths);

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /defaults/);
  assert.match(result.output, /runtime\.port/);
});

test("config set persists a validated value", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["set", "runtime.port", "9000"], paths);

  assert.equal(result.exitCode, 0);
  const onDisk = JSON.parse(await readFile(paths.configFile, "utf8")) as {
    runtime: { port: number };
  };
  assert.equal(onDisk.runtime.port, 9000);
});

test("config set rejects invalid values without writing", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["set", "runtime.host", "0.0.0.0"], paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /loopback/i);
  await assert.rejects(stat(paths.configFile));
});

test("config set rejects unknown keys with the offending path", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["set", "runtime.hosts", "127.0.0.1"], paths);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /runtime\.hosts/);
});

test("config set requires a key and a value", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["set", "runtime.port"], paths);

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /usage/i);
});

test("config reset restores defaults and keeps the previous file as backup", async () => {
  const paths = await makePaths();
  await runConfigCommand(["set", "runtime.port", "9000"], paths);
  const result = await runConfigCommand(["reset"], paths);

  assert.equal(result.exitCode, 0);
  const onDisk = JSON.parse(await readFile(paths.configFile, "utf8")) as {
    runtime: { port: number };
  };
  assert.equal(onDisk.runtime.port, DEFAULT_CONFIG.runtime.port);
  const backup = JSON.parse(await readFile(paths.configBackupFile, "utf8")) as {
    runtime: { port: number };
  };
  assert.equal(backup.runtime.port, 9000);
});

test("unknown subcommands exit with usage", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["frobnicate"], paths);

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /usage/i);
});

test("config preset lists the available presets", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["preset"], paths);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /compatibility:/);
  assert.match(result.output, /balanced:/);
  assert.match(result.output, /max-reasoning:/);
});

test("config preset applies a named preset and persists it", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["preset", "max-reasoning"], paths);
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /Applied preset "max-reasoning"/);

  const stored = JSON.parse(await readFile(paths.configFile, "utf8")) as {
    reasoning: { effort: string };
    context: { maxOutputTokens: number };
    models: { main: string };
  };
  assert.equal(stored.reasoning.effort, "xhigh");
  assert.equal(stored.context.maxOutputTokens, 65_536);
  assert.equal(stored.models.main, DEFAULT_CONFIG.models.main);
});

test("config preset rejects unknown names without writing", async () => {
  const paths = await makePaths();
  const result = await runConfigCommand(["preset", "turbo"], paths);
  assert.equal(result.exitCode, 2);
  assert.match(result.output, /Unknown preset/);
  await assert.rejects(readFile(paths.configFile, "utf8"));
});
