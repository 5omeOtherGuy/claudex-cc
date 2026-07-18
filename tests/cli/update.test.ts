import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  renderUpdateReport,
  runUpdateCommand,
  type UpdateOptions,
} from "../../src/commands/update.js";
import { getActiveGateway } from "../../src/gateway/activate.js";
import type { Downloader, Extractor } from "../../src/gateway/install.js";
import type { GatewayManifest } from "../../src/gateway/manifest.js";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

const ARCHIVE_BYTES = Buffer.from("fake-gateway-archive-next");

function nextManifest(overrides?: { sha256?: string }): GatewayManifest {
  return {
    version: "7.3.0",
    artifacts: {
      "linux-x64": {
        assetName: "gw_next_linux_amd64.tar.gz",
        url: "https://example.invalid/v7.3.0/gw_next_linux_amd64.tar.gz",
        sha256: overrides?.sha256 ?? createHash("sha256").update(ARCHIVE_BYTES).digest("hex"),
        archive: "tar.gz",
        binaryName: "cli-proxy-api",
      },
    },
  };
}

interface Fixture {
  readonly paths: ClaudexPaths;
  readonly options: UpdateOptions;
  readonly systemctlCalls: string[][];
  readonly unitDir: string;
}

async function makeFixture(overrides?: Partial<UpdateOptions>): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "claudex-update-"));
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

  const downloader: Downloader = async ({ destination }) => {
    await writeFile(destination, ARCHIVE_BYTES);
  };
  const extractor: Extractor = async ({ archiveFile, targetDir }) => {
    const bytes = await readFile(archiveFile);
    await writeFile(join(targetDir, "cli-proxy-api"), bytes, { mode: 0o755 });
  };
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
    options: {
      paths,
      platform: "linux",
      arch: "x64",
      unitDir,
      apply: true,
      manifest: nextManifest(),
      downloader,
      extractor,
      runner,
      probe: async () => true,
      ...overrides,
    },
  };
}

async function installCurrentGateway(paths: ClaudexPaths, version = "7.2.86"): Promise<void> {
  const versionDir = join(paths.dataDir, "gateway", "versions", version);
  await mkdir(versionDir, { recursive: true });
  const binaryFile = join(versionDir, "cli-proxy-api");
  await writeFile(binaryFile, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version, binaryFile }),
    { mode: 0o600 },
  );
}

async function writeConfig(paths: ClaudexPaths, mode: "persistent" | "session"): Promise<void> {
  await mkdir(paths.configDir, { recursive: true });
  const config = {
    configVersion: 1,
    runtime: { mode, host: "127.0.0.1", port: 8317 },
    gateway: { implementation: "cliproxyapi", version: "7.2.86", updateChannel: "pinned" },
    models: { main: "a", subagent: "b", fallback: "c" },
    reasoning: { effort: "medium" },
    context: { advertisedWindow: 372000, compactAt: 230000, maxOutputTokens: 32768 },
  };
  await writeFile(paths.configFile, JSON.stringify(config));
}

test("check mode reports version, checksum, and impact without changing anything", async () => {
  const fixture = await makeFixture({ apply: false });
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "session");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, true);
  assert.equal(report.applied, false);
  assert.equal(report.plan.currentVersion, "7.2.86");
  assert.equal(report.plan.targetVersion, "7.3.0");
  assert.equal(report.plan.sha256, createHash("sha256").update(ARCHIVE_BYTES).digest("hex"));
  assert.match(report.plan.impact, /rollback/i);
  assert.equal((await getActiveGateway(fixture.paths))?.version, "7.2.86");

  const rendered = renderUpdateReport(report);
  assert.match(rendered, /sha256/);
  assert.match(rendered, /Dry run only/);
});

test("an up-to-date gateway applies nothing", async () => {
  const fixture = await makeFixture({
    manifest: {
      ...nextManifest(),
      version: "7.2.86",
    },
  });
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "session");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, true);
  assert.equal(report.applied, false);
  assert.equal(report.plan.upToDate, true);
  assert.match(renderUpdateReport(report), /Nothing to do/);
});

test("session-mode update installs, activates, and re-pins the config", async () => {
  const fixture = await makeFixture();
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "session");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.equal(report.applied, true);
  assert.equal((await getActiveGateway(fixture.paths))?.version, "7.3.0");

  const config = JSON.parse(await readFile(fixture.paths.configFile, "utf8")) as {
    gateway: { version: string };
  };
  assert.equal(config.gateway.version, "7.3.0");
  assert.equal(fixture.systemctlCalls.length, 0, "session mode never touches systemd");
});

test("checksum mismatch stops the update before activation", async () => {
  const fixture = await makeFixture({ manifest: nextManifest({ sha256: "0".repeat(64) }) });
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "session");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, false);
  const install = report.steps.find((step) => step.name === "install");
  assert.match(install?.detail ?? "", /checksum mismatch/i);
  assert.equal((await getActiveGateway(fixture.paths))?.version, "7.2.86");
});

const skipOnWindows = { skip: process.platform === "win32" };

test("persistent update restarts the service and verifies health", skipOnWindows, async () => {
  const fixture = await makeFixture();
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "persistent");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.ok(fixture.systemctlCalls.some((call) => call[0] === "restart"));
  const unit = await readFile(join(fixture.unitDir, "claudex-gateway.service"), "utf8");
  assert.match(unit, /versions\/7\.3\.0/);
});

test("an unhealthy updated gateway rolls back to the previous version", skipOnWindows, async () => {
  const fixture = await makeFixture({ probe: async () => false, healthTimeoutMs: 0 });
  await installCurrentGateway(fixture.paths);
  await writeConfig(fixture.paths, "persistent");

  const report = await runUpdateCommand(fixture.options);
  assert.equal(report.ok, false);
  const rollback = report.steps.find((step) => step.name === "rollback");
  assert.equal(rollback?.status, "rolled-back");
  assert.equal((await getActiveGateway(fixture.paths))?.version, "7.2.86");
  const unit = await readFile(join(fixture.unitDir, "claudex-gateway.service"), "utf8");
  assert.match(unit, /versions\/7\.2\.86/, "the unit points back at the previous binary");
  assert.match(renderUpdateReport(report), /previous gateway version was reactivated/);
});
