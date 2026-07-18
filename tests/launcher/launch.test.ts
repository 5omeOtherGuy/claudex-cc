import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ClaudeSpawn } from "../../src/launcher/launch.js";
import {
  checkGlobalClaudeConflicts,
  executeClaude,
  prepareLaunch,
} from "../../src/launcher/launch.js";
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
  const versionDir = join(paths.dataDir, "gateway", "versions", "1.0.0");
  await mkdir(versionDir, { recursive: true });
  const binary = join(versionDir, "cli-proxy-api");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
  await mkdir(join(paths.dataDir, "gateway"), { recursive: true });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version: "1.0.0", binaryFile: binary }),
  );
}

async function installFakeCredential(paths: ClaudexPaths): Promise<void> {
  await mkdir(paths.credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(join(paths.credentialsDir, "codex.json"), "{}", { mode: 0o600 });
}

class FakeClaude extends EventEmitter {
  public readonly signals: string[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }
}

test("launch readiness fails closed without an activated gateway", async () => {
  const paths = await makePaths();
  const result = await prepareLaunch({ paths, config: DEFAULT_CONFIG, probe: async () => true });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "gateway_missing");
});

test("launch readiness fails closed without credentials", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  const result = await prepareLaunch({ paths, config: DEFAULT_CONFIG, probe: async () => true });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "not_logged_in");
});

test("persistent mode requires a healthy gateway and yields the claude env", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  await installFakeCredential(paths);

  const unhealthy = await prepareLaunch({
    paths,
    config: DEFAULT_CONFIG,
    probe: async () => false,
  });
  assert.equal(unhealthy.ok, false);
  assert.ok(!unhealthy.ok && unhealthy.reason === "gateway_unhealthy");

  const ready = await prepareLaunch({ paths, config: DEFAULT_CONFIG, probe: async () => true });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(
    ready.env.ANTHROPIC_BASE_URL,
    `http://${DEFAULT_CONFIG.runtime.host}:${DEFAULT_CONFIG.runtime.port}`,
  );
  assert.equal(ready.env.ANTHROPIC_MODEL, DEFAULT_CONFIG.models.main);
  assert.ok((ready.env.ANTHROPIC_AUTH_TOKEN ?? "").length > 0);
});

test("executeClaude merges env, forwards args, propagates the exit code, and cleans up", async () => {
  const child = new FakeClaude();
  let spawned:
    | { command: string; args: readonly string[]; env: Record<string, string> }
    | undefined;
  const spawnFn: ClaudeSpawn = (command, args, options) => {
    spawned = { command, args, env: options.env };
    queueMicrotask(() => child.emit("exit", 3, null));
    return child;
  };
  let cleaned = 0;

  const code = await executeClaude({
    claudeCommand: "claude",
    args: ["--continue"],
    env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
    baseEnv: { PATH: "/usr/bin", HOME: "/home/u" },
    spawnFn,
    cleanup: async () => {
      cleaned += 1;
    },
  });

  assert.equal(code, 3);
  assert.equal(cleaned, 1);
  assert.ok(spawned !== undefined);
  assert.equal(spawned.command, "claude");
  assert.deepEqual(spawned.args, ["--continue"]);
  assert.equal(spawned.env.PATH, "/usr/bin", "parent env must be preserved");
  assert.equal(spawned.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:9");
});

test("signals are forwarded to the claude child, not handled by the launcher", async () => {
  const child = new FakeClaude();
  const signalSource = new EventEmitter();
  const spawnFn: ClaudeSpawn = () => {
    setTimeout(() => {
      signalSource.emit("SIGINT");
      child.emit("exit", null, "SIGINT");
    }, 5);
    return child;
  };

  const code = await executeClaude({
    claudeCommand: "claude",
    args: [],
    env: {},
    baseEnv: {},
    spawnFn,
    signalSource,
    cleanup: async () => {},
  });

  assert.deepEqual(child.signals, ["SIGINT"]);
  assert.equal(code, 130, "signal exits map to conventional 128+signal codes");
});

test("global claude settings that override model routing are diagnosed, never modified", async () => {
  const root = await mkdtemp(join(tmpdir(), "claudex-gset-"));
  const settingsFile = join(root, "settings.json");
  await writeFile(
    settingsFile,
    JSON.stringify({
      model: "some-global-model",
      env: { ANTHROPIC_BASE_URL: "https://other-gateway.invalid" },
    }),
  );
  const before = await import("node:fs/promises").then((fs) => fs.readFile(settingsFile, "utf8"));

  const conflicts = await checkGlobalClaudeConflicts(settingsFile);
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.some((c) => c.includes("model")));
  assert.ok(conflicts.some((c) => c.includes("ANTHROPIC_BASE_URL")));

  const after = await import("node:fs/promises").then((fs) => fs.readFile(settingsFile, "utf8"));
  assert.equal(before, after, "diagnostics must never modify settings");

  assert.deepEqual(await checkGlobalClaudeConflicts(join(root, "missing.json")), []);
});
