import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLaunchCommand } from "../../src/commands/launch.js";
import { type ClaudexConfig, DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ClaudeChild, ClaudeSpawn } from "../../src/launcher/launch.js";
import type { GatewayLauncher, GatewayProcess } from "../../src/lifecycle/session.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-launch-"));
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

async function installFakeGateway(paths: ClaudexPaths): Promise<void> {
  const versionDir = join(paths.dataDir, "gateway", "versions", "7.2.86");
  await mkdir(versionDir, { recursive: true });
  const binaryFile = join(versionDir, "cli-proxy-api");
  await writeFile(binaryFile, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version: "7.2.86", binaryFile }),
    { mode: 0o600 },
  );
}

async function persistFakeCredential(paths: ClaudexPaths): Promise<void> {
  await mkdir(paths.credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(join(paths.credentialsDir, "codex.json"), JSON.stringify({ ok: true }), {
    mode: 0o600,
  });
}

class FakeClaude extends EventEmitter implements ClaudeChild {
  kill(): boolean {
    return true;
  }
}

interface SpawnRecord {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}

function fakeClaudeSpawn(records: SpawnRecord[], exitCode = 0): ClaudeSpawn {
  return (command, args, options) => {
    records.push({ command, args, env: options.env });
    const child = new FakeClaude();
    setTimeout(() => child.emit("exit", exitCode, null), 0);
    return child;
  };
}

class FakeGatewayProcess extends EventEmitter implements GatewayProcess {
  kill(): boolean {
    setTimeout(() => this.emit("exit", 0, null), 0);
    return true;
  }
}

const sessionConfig: ClaudexConfig = {
  ...DEFAULT_CONFIG,
  runtime: { ...DEFAULT_CONFIG.runtime, mode: "session" },
};

test("persistent launch fails closed with the readiness ladder", async () => {
  const paths = await makePaths();
  const records: SpawnRecord[] = [];

  const missing = await runLaunchCommand({
    paths,
    config: DEFAULT_CONFIG,
    args: [],
    spawnFn: fakeClaudeSpawn(records),
    probe: async () => true,
  });
  assert.equal(missing.exitCode, 1);
  assert.match(missing.output, /gateway_missing/);

  await installFakeGateway(paths);
  const noLogin = await runLaunchCommand({
    paths,
    config: DEFAULT_CONFIG,
    args: [],
    spawnFn: fakeClaudeSpawn(records),
    probe: async () => true,
  });
  assert.equal(noLogin.exitCode, 1);
  assert.match(noLogin.output, /not_logged_in/);

  await persistFakeCredential(paths);
  const unhealthy = await runLaunchCommand({
    paths,
    config: DEFAULT_CONFIG,
    args: [],
    spawnFn: fakeClaudeSpawn(records),
    probe: async () => false,
  });
  assert.equal(unhealthy.exitCode, 1);
  assert.match(unhealthy.output, /gateway_unhealthy/);
  assert.equal(records.length, 0, "claude must never start before readiness passes");
});

test("persistent launch hands Claude Code the gateway environment", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  await persistFakeCredential(paths);
  const records: SpawnRecord[] = [];

  const result = await runLaunchCommand({
    paths,
    config: DEFAULT_CONFIG,
    args: ["--continue"],
    baseEnv: { PATH: "/usr/bin", HOME: "/home/u" },
    spawnFn: fakeClaudeSpawn(records),
    probe: async () => true,
  });

  assert.equal(result.exitCode, 0);
  const record = records[0];
  assert.ok(record !== undefined);
  assert.equal(record.command, "claude");
  assert.deepEqual(record.args, ["--continue"]);
  assert.equal(record.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8317");
  assert.equal(record.env.ANTHROPIC_MODEL, DEFAULT_CONFIG.models.main);
  assert.equal(record.env.PATH, "/usr/bin");
  assert.ok((record.env.ANTHROPIC_AUTH_TOKEN ?? "").length >= 32);
});

test("session launch starts a gateway, runs Claude, and stops it afterwards", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  await persistFakeCredential(paths);
  const records: SpawnRecord[] = [];
  let gatewayStops = 0;

  const launcher: GatewayLauncher = {
    launch: async () => {
      const child = new FakeGatewayProcess();
      const originalKill = child.kill.bind(child);
      child.kill = () => {
        gatewayStops += 1;
        return originalKill();
      };
      return child;
    },
  };

  const result = await runLaunchCommand({
    paths,
    config: sessionConfig,
    args: [],
    spawnFn: fakeClaudeSpawn(records, 7),
    probe: async () => true,
    launcher,
  });

  assert.equal(result.exitCode, 7, "claude's exit code is passed through");
  assert.equal(records.length, 1);
  assert.ok(gatewayStops >= 1, "the session gateway is stopped after claude exits");
  const record = records[0];
  assert.ok(record !== undefined);
  assert.match(record.env.ANTHROPIC_BASE_URL ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("session launch fails closed without credentials", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  const records: SpawnRecord[] = [];

  const result = await runLaunchCommand({
    paths,
    config: sessionConfig,
    args: [],
    spawnFn: fakeClaudeSpawn(records),
    probe: async () => true,
    launcher: { launch: async () => new FakeGatewayProcess() },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /not_logged_in/);
  assert.equal(records.length, 0);
});
