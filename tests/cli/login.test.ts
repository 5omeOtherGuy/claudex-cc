import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LoginDriver, LoginEvent } from "../../src/auth/orchestrator.js";
import { runLoginCommand } from "../../src/commands/login.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-login-"));
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
  const gatewayDir = join(paths.dataDir, "gateway");
  await writeFile(
    join(gatewayDir, "active.json"),
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

function driverFrom(events: readonly LoginEvent[], onPersist?: () => Promise<void>): LoginDriver {
  return {
    async *start() {
      for (const event of events) {
        if (event.kind === "persisted" && onPersist !== undefined) {
          await onPersist();
        }
        yield event;
      }
    },
  };
}

test("login refuses to run before setup installed a gateway", async () => {
  const paths = await makePaths();
  const result = await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "device",
    onProgress: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /setup/);
});

test("device login succeeds after persistence and an authenticated probe", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  const progress: string[] = [];

  const result = await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "device",
    onProgress: (line) => progress.push(line),
    driverFactory: () =>
      driverFrom(
        [
          {
            kind: "device_prompt",
            userCode: "ABCD-1234",
            verificationUrl: "https://auth.openai.com/codex/device",
            expiresInSeconds: 900,
          },
          { kind: "persisted" },
        ],
        () => persistFakeCredential(paths),
      ),
    probe: async () => ({ ok: true }),
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /verified with an authenticated request/);
  assert.ok(progress.some((line) => line.includes("ABCD-1234")));
});

test("browser login exposes only safe progress to the in-product workflow", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  const progress: string[] = [];

  const result = await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "browser",
    onProgress: (line) => progress.push(line),
    driverFactory: () =>
      driverFrom(
        [
          { kind: "browser_prompt" },
          { kind: "browser_callback_validated" },
          { kind: "persisted" },
        ],
        () => persistFakeCredential(paths),
      ),
    probe: async () => ({ ok: true }),
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.match(progress.join("\n"), /browser|callback|verified/i);
  assert.doesNotMatch(progress.join("\n"), /private-state|auth\.example/);
});

test("login writes the gateway config the login process reads", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);
  let seenConfigFile = "";

  await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "device",
    onProgress: () => {},
    driverFactory: (_binary, configFile) => {
      seenConfigFile = configFile;
      return driverFrom([{ kind: "failed", detail: "stop here" }]);
    },
    probe: async () => ({ ok: true }),
  });

  assert.equal(seenConfigFile, join(paths.stateDir, "gateway-persistent.yaml"));
});

test("a login that never persists fails with a remediation", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);

  const result = await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "device",
    onProgress: () => {},
    driverFactory: () => driverFrom([{ kind: "failed", detail: "polling failed" }]),
    probe: async () => ({ ok: true }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Login failed \(failed\)/);
  assert.match(result.output, /doctor/i);
});

test("persisted credentials with a failing probe do not claim success", async () => {
  const paths = await makePaths();
  await installFakeGateway(paths);

  const result = await runLoginCommand({
    paths,
    config: DEFAULT_CONFIG,
    mode: "device",
    onProgress: () => {},
    driverFactory: () => driverFrom([{ kind: "persisted" }], () => persistFakeCredential(paths)),
    probe: async () => ({ ok: false, status: "unauthorized", detail: "401 from provider" }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Login failed \(validation\)/);
});
