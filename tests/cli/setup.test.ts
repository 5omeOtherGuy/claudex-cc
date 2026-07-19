import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSetupPlan,
  renderSetupReport,
  runSetup,
  runSetupPreflight,
  type SetupOptions,
} from "../../src/commands/setup.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { getActiveGateway } from "../../src/gateway/activate.js";
import type { Downloader, Extractor } from "../../src/gateway/install.js";
import type { GatewayManifest } from "../../src/gateway/manifest.js";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

const ARCHIVE_BYTES = Buffer.from("fake-gateway-archive");

function testManifest(overrides?: { sha256?: string }): GatewayManifest {
  const sha256 = overrides?.sha256 ?? createHash("sha256").update(ARCHIVE_BYTES).digest("hex");
  const artifact = (assetName: string) => ({
    assetName,
    url: `https://example.invalid/v7.2.86/${assetName}`,
    sha256,
    archive: "tar.gz" as const,
    binaryName: "cli-proxy-api",
  });
  return {
    version: "7.2.86",
    artifacts: {
      "linux-x64": artifact("gw_linux_amd64.tar.gz"),
      "darwin-arm64": artifact("gw_darwin_aarch64.tar.gz"),
    },
  };
}

interface Fixture {
  readonly paths: ClaudexPaths;
  readonly options: SetupOptions;
  readonly systemctlCalls: string[][];
  readonly binDir: string;
  readonly unitDir: string;
}

async function makeFixture(overrides?: Partial<SetupOptions>): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "claudex-setup-"));
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
    binDir,
    unitDir,
    systemctlCalls,
    options: {
      paths,
      platform: "linux",
      arch: "x64",
      binDir,
      unitDir,
      managerEntry: "/opt/claudex/dist/src/cli.js",
      manifest: testManifest(),
      downloader,
      extractor,
      runner,
      probe: async () => true,
      ...overrides,
    },
  };
}

// The systemd unit embeds real fixture paths; on Windows hosts those contain
// backslashes, which the embeddable-path guard rightly rejects. The service
// path is Linux-only behavior, so persistent-mode setup runs are skipped there.
const skipOnWindows = { skip: process.platform === "win32" };

test("setup plan defines a single global reasoning control", () => {
  const plan = buildSetupPlan(DEFAULT_CONFIG);

  assert.equal(plan.version, 1);
  assert.deepEqual(plan.current, {
    runtimeMode: "persistent",
    models: DEFAULT_CONFIG.models,
    reasoningEffort: "medium",
  });
  assert.deepEqual(
    plan.customization.map((question) => question.id),
    ["runtime", "models", "reasoning"],
  );

  const reasoning = plan.customization.find((question) => question.id === "reasoning");
  assert.ok(reasoning !== undefined && reasoning.id === "reasoning");
  assert.equal(reasoning.key, "reasoning.effort");
  assert.equal(reasoning.scope, "global");
  assert.deepEqual(reasoning.appliesTo, ["main", "subagent", "fallback"]);
  assert.deepEqual(reasoning.values, ["low", "medium", "high", "xhigh", "max"]);
  assert.match(reasoning.question, /one global reasoning effort/i);
});

test("setup preflight reports deterministic blockers and warnings before installation", async () => {
  const fixture = await makeFixture();
  await mkdir(fixture.binDir, { recursive: true });
  await writeFile(join(fixture.binDir, "claudex"), "#!/bin/sh\necho foreign\n", { mode: 0o755 });
  await mkdir(fixture.paths.configDir, { recursive: true });
  const claudeSettingsFile = join(fixture.paths.configDir, "claude-settings.json");
  await writeFile(claudeSettingsFile, JSON.stringify({ model: "custom-model" }));

  const report = await runSetupPreflight({
    paths: fixture.paths,
    platform: "linux",
    arch: "x64",
    binDir: fixture.binDir,
    manifest: testManifest(),
    pathValue: "/usr/bin",
    claudeSettingsFile,
  });
  const checks = new Map(report.checks.map((check) => [check.name, check]));

  assert.equal(report.ok, false);
  assert.equal(checks.get("config")?.status, "pass");
  assert.equal(checks.get("platform")?.status, "pass");
  assert.equal(checks.get("launcher")?.status, "fail");
  assert.match(checks.get("launcher")?.remediation ?? "", /back up|rename/i);
  assert.equal(checks.get("launcher-path")?.status, "warn");
  assert.equal(checks.get("claude-settings")?.status, "warn");
  assert.match(checks.get("claude-settings")?.detail ?? "", /model/i);
});

async function writeConfigWithMode(
  fixture: Fixture,
  mode: "persistent" | "session",
  gatewayVersion = "7.2.86",
): Promise<void> {
  await mkdir(fixture.paths.configDir, { recursive: true });
  const config = {
    configVersion: 1,
    runtime: { mode, host: "127.0.0.1", port: 8317 },
    gateway: { implementation: "cliproxyapi", version: gatewayVersion, updateChannel: "pinned" },
    models: { main: "a", subagent: "b", fallback: "c" },
    reasoning: { effort: "medium" },
    context: { advertisedWindow: 372000, compactAt: 230000, maxOutputTokens: 32768 },
  };
  await writeFile(fixture.paths.configFile, JSON.stringify(config));
}

test("setup installs config, gateway, service, and shim end to end", skipOnWindows, async () => {
  const fixture = await makeFixture();
  const report = await runSetup(fixture.options);

  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  assert.deepEqual(
    report.steps.map((step) => [step.name, step.status]),
    [
      ["preflight", "ok"],
      ["config", "ok"],
      ["gateway-install", "ok"],
      ["gateway-activate", "ok"],
      ["gateway-config", "ok"],
      ["service", "ok"],
      ["health", "ok"],
      ["launcher-shim", "ok"],
    ],
  );

  const config = JSON.parse(await readFile(fixture.paths.configFile, "utf8")) as {
    configVersion: number;
  };
  assert.equal(config.configVersion, 2);

  const active = await getActiveGateway(fixture.paths);
  assert.equal(active?.version, "7.2.86");
  await stat(active?.binaryFile ?? "");

  const gatewayConfig = await readFile(
    join(fixture.paths.stateDir, "gateway-persistent.yaml"),
    "utf8",
  );
  assert.match(gatewayConfig, /host: "127\.0\.0\.1"/);
  const mode = (await stat(join(fixture.paths.stateDir, "gateway-persistent.yaml"))).mode & 0o777;
  assert.equal(mode, 0o600);

  const shim = await readFile(join(fixture.binDir, "claudex"), "utf8");
  assert.match(shim, /Managed by Claudex/);
  assert.match(shim, /launch "\$@"/);

  const unit = await readFile(join(fixture.unitDir, "claudex-gateway.service"), "utf8");
  assert.match(unit, /Managed by Claudex/);
  assert.ok(fixture.systemctlCalls.some((call) => call[0] === "enable"));
  assert.ok(fixture.systemctlCalls.some((call) => call[0] === "start"));

  assert.equal(report.relaunchRequired, true);
});

test("setup is idempotent: a second run skips the completed install", async () => {
  const fixture = await makeFixture();
  await writeConfigWithMode(fixture, "session");
  assert.equal((await runSetup(fixture.options)).ok, true);

  const second = await runSetup(fixture.options);
  assert.equal(second.ok, true);
  const install = second.steps.find((step) => step.name === "gateway-install");
  assert.equal(install?.status, "skipped");
});

test("checksum mismatch fails the install step and stops dependent steps", async () => {
  const fixture = await makeFixture({ manifest: testManifest({ sha256: "0".repeat(64) }) });
  const report = await runSetup(fixture.options);

  assert.equal(report.ok, false);
  const install = report.steps.find((step) => step.name === "gateway-install");
  assert.equal(install?.status, "failed");
  assert.match(install?.detail ?? "", /checksum mismatch/i);
  assert.equal(
    report.steps.some((step) => step.name === "launcher-shim"),
    false,
  );
  assert.equal(await getActiveGateway(fixture.paths), undefined);
});

test("a config pinning a different gateway version fails closed", async () => {
  const fixture = await makeFixture();
  await writeConfigWithMode(fixture, "persistent", "9.9.9");

  const report = await runSetup(fixture.options);
  assert.equal(report.ok, false);
  const install = report.steps.find((step) => step.name === "gateway-install");
  assert.match(install?.detail ?? "", /pins gateway 9\.9\.9/);
});

test("a foreign claudex launcher fails before setup mutates installation state", async () => {
  const fixture = await makeFixture();
  await writeConfigWithMode(fixture, "session");
  await mkdir(fixture.binDir, { recursive: true });
  await writeFile(join(fixture.binDir, "claudex"), "#!/bin/sh\necho not ours\n", { mode: 0o755 });
  const originalConfig = await readFile(fixture.paths.configFile, "utf8");

  const report = await runSetup(fixture.options);
  assert.equal(report.ok, false);
  assert.equal(report.steps[0]?.name, "preflight");
  assert.equal(report.steps[0]?.status, "failed");
  assert.match(report.steps[0]?.detail ?? "", /not managed by Claudex/);
  assert.equal(await getActiveGateway(fixture.paths), undefined);
  assert.equal(await readFile(fixture.paths.configFile, "utf8"), originalConfig);
});

test("a non-file claudex launcher path fails preflight", async () => {
  const fixture = await makeFixture();
  await mkdir(fixture.binDir, { recursive: true });
  await mkdir(join(fixture.binDir, "claudex"));

  const report = await runSetupPreflight({
    paths: fixture.paths,
    platform: "linux",
    arch: "x64",
    binDir: fixture.binDir,
    manifest: testManifest(),
  });
  const launcher = report.checks.find((check) => check.name === "launcher");

  assert.equal(report.ok, false);
  assert.equal(launcher?.status, "fail");
  assert.match(launcher?.detail ?? "", /not a regular file/i);
});

test("session-mode config skips the service and still succeeds", async () => {
  const fixture = await makeFixture();
  await writeConfigWithMode(fixture, "session");

  const report = await runSetup(fixture.options);
  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  const service = report.steps.find((step) => step.name === "service");
  assert.equal(service?.status, "skipped");
  assert.equal(fixture.systemctlCalls.length, 0);
});

test("unavailable user systemd falls back to session launches", async () => {
  const fixture = await makeFixture({
    runner: {
      run: async (args) => ({
        code: args[0] === "show-environment" ? 1 : 0,
        stdout: "",
        stderr: "",
      }),
    },
  });
  const report = await runSetup(fixture.options);
  assert.equal(report.ok, true);
  const service = report.steps.find((step) => step.name === "service");
  assert.equal(service?.status, "skipped");
  assert.match(service?.detail ?? "", /session mode/i);
});

test("the rendered report explains the relaunch requirement", async () => {
  const fixture = await makeFixture();
  await writeConfigWithMode(fixture, "session");
  const report = await runSetup(fixture.options);
  const rendered = renderSetupReport(report);
  assert.match(rendered, /already-running Claude Code session keeps its current provider/);
  assert.match(rendered, /login/);
});

test("darwin persistent setup installs and boots a LaunchAgent", skipOnWindows, async () => {
  const launchctlCalls: string[][] = [];
  const fixture = await makeFixture({
    platform: "darwin",
    arch: "arm64",
    launchctl: {
      run: async (args) => {
        launchctlCalls.push([...args]);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    uid: 501,
  });
  const agentDir = join(fixture.unitDir, "..", "LaunchAgents");
  const report = await runSetup({ ...fixture.options, agentDir });

  assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
  const service = report.steps.find((step) => step.name === "service");
  assert.match(service?.detail ?? "", /launchd/);

  const plist = await readFile(join(agentDir, "com.claudex.gateway.plist"), "utf8");
  assert.match(plist, /Managed by Claudex/);
  assert.match(plist, /com\.claudex\.gateway/);
  assert.ok(launchctlCalls.some((call) => call[0] === "bootstrap"));
  assert.ok(launchctlCalls.some((call) => call[0] === "kickstart"));
  assert.equal(fixture.systemctlCalls.length, 0, "darwin setup never calls systemctl");
});
