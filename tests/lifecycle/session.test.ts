import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { GatewayLauncher, GatewayProcess, HealthProbe } from "../../src/lifecycle/session.js";
import { buildClaudeEnv, startSessionGateway } from "../../src/lifecycle/session.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-sess-"));
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

class FakeChild extends EventEmitter implements GatewayProcess {
  public readonly signals: string[] = [];
  public exited = false;
  constructor(private readonly dieOnTerm = true) {
    super();
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "SIGTERM");
    if (this.dieOnTerm && !this.exited) {
      this.exited = true;
      queueMicrotask(() => this.emit("exit", 0, signal ?? "SIGTERM"));
    }
    return true;
  }
  simulateCrash(code: number): void {
    if (!this.exited) {
      this.exited = true;
      this.emit("exit", code, null);
    }
  }
}

function launcherOf(child: FakeChild): GatewayLauncher & { launches: unknown[] } {
  const record: unknown[] = [];
  return {
    launches: record,
    launch: async (request) => {
      record.push(request);
      return child;
    },
  };
}

const healthyProbe: HealthProbe = async () => true;
const deadProbe: HealthProbe = async () => false;

const baseOptions = (paths: ClaudexPaths, child: FakeChild) => ({
  paths,
  config: DEFAULT_CONFIG,
  binaryFile: "/fake/cli-proxy-api",
  launcher: launcherOf(child),
  probe: healthyProbe,
  probeIntervalMs: 5,
  startupTimeoutMs: 200,
});

test("startup selects a loopback port, generates a secret, and waits for health", async () => {
  const paths = await makePaths();
  const child = new FakeChild();
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: 0 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.host, "127.0.0.1");
  assert.ok(result.session.port > 0);
  assert.match(result.session.clientSecret, /^[a-f0-9]{48}$/);
  await result.session.stop();
});

test("two sessions get distinct client secrets", async () => {
  const paths = await makePaths();
  const first = await startSessionGateway({ ...baseOptions(paths, new FakeChild()), port: 0 });
  const second = await startSessionGateway({ ...baseOptions(paths, new FakeChild()), port: 0 });
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.notEqual(first.session.clientSecret, second.session.clientSecret);
    const files = await readdir(join(paths.stateDir, "sessions"));
    assert.equal(files.length, 2, "concurrent sessions keep their own state files");
    await first.session.stop();
    await second.session.stop();
  }
});

test("a configured port that is already bound fails closed as a port conflict", async () => {
  const paths = await makePaths();
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const address = blocker.address();
  assert.ok(address !== null && typeof address === "object");
  const busyPort = address.port;

  const child = new FakeChild();
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: busyPort });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "port_conflict");
  assert.equal(child.signals.length, 0, "no process must be spawned on port conflict");
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
});

test("health probe never succeeding times out and terminates the sidecar", async () => {
  const paths = await makePaths();
  const child = new FakeChild();
  const result = await startSessionGateway({
    ...baseOptions(paths, child),
    port: 0,
    probe: deadProbe,
    startupTimeoutMs: 40,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "startup_timeout");
  assert.ok(child.signals.length > 0, "sidecar must be terminated after timeout");
});

test("a crashing gateway process reports the crash", async () => {
  const paths = await makePaths();
  const child = new FakeChild();
  const crashingLauncher: GatewayLauncher = {
    launch: async () => {
      setTimeout(() => child.simulateCrash(1), 0);
      return child;
    },
  };
  const result = await startSessionGateway({
    ...baseOptions(paths, child),
    port: 0,
    launcher: crashingLauncher,
    probe: deadProbe,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "crashed");
});

test("stop terminates only the owned child and clears session state", async () => {
  const paths = await makePaths();
  const child = new FakeChild();
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: 0 });
  assert.ok(result.ok);
  if (!result.ok) return;

  await result.session.stop();
  assert.deepEqual(child.signals, ["SIGTERM"]);
  const stateFiles = await readdir(join(paths.stateDir, "sessions")).catch(() => []);
  assert.deepEqual(stateFiles, [], "session state must be removed on stop");

  await result.session.stop();
  assert.deepEqual(child.signals, ["SIGTERM"], "stop must be idempotent");
});

test("an unresponsive child is escalated to SIGKILL", async () => {
  const paths = await makePaths();
  const child = new FakeChild(false);
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: 0 });
  assert.ok(result.ok);
  if (!result.ok) return;

  await result.session.stop({ graceMs: 20 });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("stale session state from a crashed run is cleaned without killing anything", async () => {
  const paths = await makePaths();
  const sessionsDir = join(paths.stateDir, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, "stale.json"), JSON.stringify({ pid: 999_999_999 }));

  const child = new FakeChild();
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: 0 });
  assert.ok(result.ok);
  if (!result.ok) return;

  const files = await readdir(sessionsDir);
  assert.equal(files.length, 1, "stale file is replaced by the live session file only");
  await result.session.stop();
});

test("claude env carries gateway address, secret, and models but no credentials paths", async () => {
  const paths = await makePaths();
  const child = new FakeChild();
  const result = await startSessionGateway({ ...baseOptions(paths, child), port: 0 });
  assert.ok(result.ok);
  if (!result.ok) return;

  const env = buildClaudeEnv(result.session, DEFAULT_CONFIG);
  assert.equal(env.ANTHROPIC_BASE_URL, `http://127.0.0.1:${result.session.port}`);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, result.session.clientSecret);
  assert.equal(env.ANTHROPIC_MODEL, DEFAULT_CONFIG.models.main);
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, DEFAULT_CONFIG.models.subagent);
  assert.ok(!JSON.stringify(env).includes(paths.credentialsDir));
  await result.session.stop();
});
