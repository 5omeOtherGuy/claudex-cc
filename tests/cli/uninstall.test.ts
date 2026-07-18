import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  renderUninstallReport,
  runUninstall,
  type UninstallOptions,
} from "../../src/commands/uninstall.js";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

interface Fixture {
  readonly paths: ClaudexPaths;
  readonly binDir: string;
  readonly unitDir: string;
  readonly systemctlCalls: string[][];
  options(overrides?: Partial<UninstallOptions>): UninstallOptions;
}

async function makeInstalledFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "claudex-uninstall-"));
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
  const binDir = join(root, "bin");
  const unitDir = join(root, "systemd");

  // A complete claudex installation.
  await mkdir(configDir, { recursive: true });
  await writeFile(paths.configFile, "{}");
  await mkdir(join(paths.dataDir, "gateway", "versions", "7.2.86"), { recursive: true });
  await writeFile(join(paths.dataDir, "gateway", "active.json"), "{}");
  await mkdir(join(stateDir, "sessions"), { recursive: true });
  await writeFile(join(stateDir, "gateway-persistent.yaml"), "host: '127.0.0.1'\n");
  await writeFile(join(stateDir, "persistent-secret"), "s".repeat(48));
  await mkdir(paths.credentialsDir, { recursive: true });
  await writeFile(join(paths.credentialsDir, "codex.json"), "{}");
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, "claudex"), "#!/usr/bin/env bash\n# Managed by Claudex\n");
  await mkdir(unitDir, { recursive: true });
  await writeFile(
    join(unitDir, "claudex-gateway.service"),
    "# Managed by Claudex\n[Service]\nExecStart=x\n",
  );

  const systemctlCalls: string[][] = [];
  const runner: SystemctlRunner = {
    run: async (args) => {
      systemctlCalls.push([...args]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };

  return {
    paths,
    binDir,
    unitDir,
    systemctlCalls,
    options: (overrides) => ({
      paths,
      platform: "linux",
      binDir,
      unitDir,
      removeCredentials: false,
      runner,
      ...overrides,
    }),
  };
}

test("uninstall removes runtime components but keeps credentials and config", async () => {
  const fixture = await makeInstalledFixture();
  const report = await runUninstall(fixture.options());

  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.equal(await exists(join(fixture.binDir, "claudex")), false);
  assert.equal(await exists(join(fixture.unitDir, "claudex-gateway.service")), false);
  assert.equal(await exists(join(fixture.paths.dataDir, "gateway")), false);
  assert.equal(await exists(join(fixture.paths.stateDir, "persistent-secret")), false);
  assert.equal(await exists(join(fixture.paths.stateDir, "gateway-persistent.yaml")), false);

  assert.equal(await exists(join(fixture.paths.credentialsDir, "codex.json")), true);
  assert.equal(await exists(fixture.paths.configFile), true);
  assert.ok(fixture.systemctlCalls.some((call) => call[0] === "disable"));

  const rendered = renderUninstallReport(report);
  assert.match(rendered, /Kept credentials/);
  assert.match(rendered, /never modified/);
});

test("uninstall deletes credentials only with the explicit flag", async () => {
  const fixture = await makeInstalledFixture();
  const report = await runUninstall(fixture.options({ removeCredentials: true }));

  assert.equal(report.ok, true);
  assert.equal(await exists(fixture.paths.credentialsDir), false);
});

test("uninstall removes the config only when asked", async () => {
  const fixture = await makeInstalledFixture();
  const report = await runUninstall(
    fixture.options({ removeCredentials: false, removeConfig: true }),
  );

  assert.equal(report.ok, true);
  assert.equal(await exists(fixture.paths.configFile), false);
});

test("a foreign launcher and a foreign unit are refused, not deleted", async () => {
  const fixture = await makeInstalledFixture();
  await writeFile(join(fixture.binDir, "claudex"), "#!/bin/sh\necho mine\n");
  await writeFile(
    join(fixture.unitDir, "claudex-gateway.service"),
    "[Service]\nExecStart=/usr/bin/other\n",
  );

  const report = await runUninstall(fixture.options());
  assert.equal(report.ok, false);
  assert.equal(await exists(join(fixture.binDir, "claudex")), true);
  assert.equal(await exists(join(fixture.unitDir, "claudex-gateway.service")), true);
  const shim = report.steps.find((step) => step.name === "launcher-shim");
  assert.equal(shim?.status, "failed");
});

test("uninstall is idempotent on an empty system", async () => {
  const fixture = await makeInstalledFixture();
  assert.equal((await runUninstall(fixture.options({ removeCredentials: true }))).ok, true);
  const second = await runUninstall(fixture.options({ removeCredentials: true }));
  assert.equal(second.ok, true);
});

test("darwin uninstall removes the managed launch agent", async () => {
  const fixture = await makeInstalledFixture();
  const agentDir = join(fixture.unitDir, "..", "LaunchAgents");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "com.claudex.gateway.plist"),
    "<!-- Managed by Claudex -->\n<plist/>\n",
  );
  const launchctlCalls: string[][] = [];

  const report = await runUninstall(
    fixture.options({
      platform: "darwin",
      agentDir,
      uid: 501,
      launchctl: {
        run: async (args) => {
          launchctlCalls.push([...args]);
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    }),
  );

  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.equal(await exists(join(agentDir, "com.claudex.gateway.plist")), false);
  assert.ok(launchctlCalls.some((call) => call[0] === "bootout"));
  assert.equal(fixture.systemctlCalls.length, 0);
});
