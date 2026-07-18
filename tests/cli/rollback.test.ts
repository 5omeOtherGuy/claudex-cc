import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type RollbackOptions,
  renderRollbackReport,
  runRollbackCommand,
} from "../../src/commands/rollback.js";
import { getActiveGateway } from "../../src/gateway/activate.js";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

interface Fixture {
  readonly paths: ClaudexPaths;
  readonly unitDir: string;
  readonly systemctlCalls: string[][];
  options(overrides?: Partial<RollbackOptions>): RollbackOptions;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "claudex-rollback-"));
  const configDir = join(root, "config");
  const stateDir = join(root, "state");
  const paths: ClaudexPaths = {
    configDir,
    configFile: join(configDir, "config.json"),
    configBackupFile: join(configDir, "config.json.bak"),
    dataDir: join(root, "data"),
    stateDir,
    credentialsDir: join(stateDir, "credentials"),
  };
  const unitDir = join(root, "systemd");
  const systemctlCalls: string[][] = [];
  const runner: SystemctlRunner = {
    run: async (args) => {
      systemctlCalls.push([...args]);
      return { code: 0, stdout: args[0] === "is-active" ? "inactive" : "", stderr: "" };
    },
  };
  return {
    paths,
    unitDir,
    systemctlCalls,
    options: (overrides) => ({
      paths,
      platform: "linux",
      unitDir,
      runner,
      probe: async () => true,
      healthTimeoutMs: 0,
      ...overrides,
    }),
  };
}

/** Simulates a completed update from 1.0.0 to 2.0.0 (pointer backup retained). */
async function installUpdatedState(
  fixture: Fixture,
  mode: "persistent" | "session",
): Promise<void> {
  const gatewayDir = join(fixture.paths.dataDir, "gateway");
  for (const version of ["1.0.0", "2.0.0"]) {
    const versionDir = join(gatewayDir, "versions", version);
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, "cli-proxy-api"), "#!/bin/sh\n", { mode: 0o755 });
  }
  await writeFile(
    join(gatewayDir, "active.json"),
    JSON.stringify({
      version: "2.0.0",
      binaryFile: join(gatewayDir, "versions", "2.0.0", "cli-proxy-api"),
    }),
  );
  await writeFile(
    join(gatewayDir, "active.json.bak"),
    JSON.stringify({
      version: "1.0.0",
      binaryFile: join(gatewayDir, "versions", "1.0.0", "cli-proxy-api"),
    }),
  );
  await mkdir(fixture.paths.configDir, { recursive: true });
  await writeFile(
    fixture.paths.configFile,
    JSON.stringify({
      configVersion: 2,
      runtime: { mode, host: "127.0.0.1", port: 8317 },
      gateway: { implementation: "cliproxyapi", version: "2.0.0", updateChannel: "pinned" },
      models: { main: "a", subagent: "b", fallback: "c" },
      reasoning: { effort: "medium" },
      context: { advertisedWindow: 372000, compactAt: 230000, maxOutputTokens: 32768 },
      requests: { retries: 3 },
      advanced: {
        sessionAffinity: false,
        streamingKeepaliveSeconds: 0,
        streamingBootstrapRetries: 0,
        remoteModelCatalog: true,
      },
    }),
  );
}

const skipOnWindows = { skip: process.platform === "win32" };

test("one command rolls back activation, config pin, and the service", skipOnWindows, async () => {
  const fixture = await makeFixture();
  await installUpdatedState(fixture, "persistent");

  const report = await runRollbackCommand(fixture.options());
  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.equal((await getActiveGateway(fixture.paths))?.version, "1.0.0");

  const config = JSON.parse(await readFile(fixture.paths.configFile, "utf8")) as {
    gateway: { version: string };
  };
  assert.equal(config.gateway.version, "1.0.0");
  assert.ok(fixture.systemctlCalls.some((call) => call[0] === "restart"));
  const unit = await readFile(join(fixture.unitDir, "claudex-gateway.service"), "utf8");
  assert.match(unit, /versions\/1\.0\.0/);
  assert.match(renderRollbackReport(report), /Rollback complete/);
});

test("session-mode rollback skips the service entirely", async () => {
  const fixture = await makeFixture();
  await installUpdatedState(fixture, "session");

  const report = await runRollbackCommand(fixture.options());
  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.equal((await getActiveGateway(fixture.paths))?.version, "1.0.0");
  assert.equal(report.steps.find((step) => step.name === "service")?.status, "skipped");
  assert.equal(fixture.systemctlCalls.length, 0);
});

test(
  "rollback after a partial failure still restores the pointer and reports the rest",
  skipOnWindows,
  async () => {
    const fixture = await makeFixture();
    await installUpdatedState(fixture, "persistent");

    const report = await runRollbackCommand(
      fixture.options({
        runner: {
          run: async (args) => ({
            code: args[0] === "restart" ? 1 : 0,
            stdout: "",
            stderr: args[0] === "restart" ? "unit failed" : "",
          }),
        },
      }),
    );

    assert.equal(report.ok, false);
    assert.equal(
      (await getActiveGateway(fixture.paths))?.version,
      "1.0.0",
      "the pointer rollback survives later step failures",
    );
    const service = report.steps.find((step) => step.name === "service");
    assert.equal(service?.status, "failed");
    assert.match(renderRollbackReport(report), /failures/);
  },
);

test("rollback without a previous activation fails with a clear message", async () => {
  const fixture = await makeFixture();
  const report = await runRollbackCommand(fixture.options());
  assert.equal(report.ok, false);
  assert.match(report.steps[0]?.detail ?? "", /No previous gateway activation/);
});
