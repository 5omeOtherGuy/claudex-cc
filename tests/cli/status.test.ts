import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectStatus, renderStatusReport } from "../../src/commands/status.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { GATEWAY_MANIFEST } from "../../src/gateway/manifest.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-stat-"));
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

test("status on an empty machine reports defaults and a blocked launch", async () => {
  const paths = await makePaths();
  const report = await collectStatus({ paths });

  assert.equal(report.configSource, "defaults");
  assert.equal(report.gateway.activeVersion, undefined);
  assert.equal(report.gateway.pinnedVersion, GATEWAY_MANIFEST.version);
  assert.equal(report.auth.present, false);
  assert.equal(report.launch.ready, false);
  assert.deepEqual(report.models, DEFAULT_CONFIG.models);
});

test("status reports launch readiness through the injected probe", async () => {
  const paths = await makePaths();
  const versionDir = join(paths.dataDir, "gateway", "versions", "1.0.0");
  await mkdir(versionDir, { recursive: true });
  const binary = join(versionDir, "cli-proxy-api");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version: "1.0.0", binaryFile: binary }),
  );
  await mkdir(paths.credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(join(paths.credentialsDir, "codex.json"), "{}", { mode: 0o600 });

  const report = await collectStatus({ paths, probe: async () => true });
  assert.equal(report.launch.ready, true);
  assert.equal(report.gateway.activeVersion, "1.0.0");

  const blocked = await collectStatus({ paths, probe: async () => false });
  assert.equal(blocked.launch.ready, false);
  assert.ok(blocked.launch.blocker?.includes("gateway_unhealthy"));
});

test("human-readable status is stable and secret-free", async () => {
  const paths = await makePaths();
  const report = await collectStatus({ paths, env: {} });
  const rendered = renderStatusReport(report);

  assert.match(rendered, /^Claudex /);
  assert.match(rendered, /config: defaults/);
  assert.match(rendered, /gateway: not installed \(pinned: /);
  assert.match(rendered, /auth: not logged in/);
  assert.match(rendered, /launch: blocked/);
  assert.doesNotMatch(rendered, /token|secret/i);
});

test("session guidance detects launches that bypass the gateway", async () => {
  const paths = await makePaths();

  const plain = await collectStatus({ paths, env: {} });
  assert.equal(plain.session.throughGateway, false);
  assert.match(plain.session.detail, /cannot switch providers/);

  const viaGateway = await collectStatus({
    paths,
    env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8317" },
  });
  assert.equal(viaGateway.session.throughGateway, true);

  const foreign = await collectStatus({
    paths,
    env: { ANTHROPIC_BASE_URL: "https://example.invalid" },
  });
  assert.equal(foreign.session.throughGateway, false);
  assert.match(foreign.session.detail, /does not manage/);
  assert.ok(
    !JSON.stringify(foreign.session).includes("example.invalid"),
    "the base URL value itself is never echoed",
  );
});

test("drift surfaces version skew between active gateway, config, and manifest", async () => {
  const paths = await makePaths();
  const versionDir = join(paths.dataDir, "gateway", "versions", "1.0.0");
  await mkdir(versionDir, { recursive: true });
  const binary = join(versionDir, "cli-proxy-api");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version: "1.0.0", binaryFile: binary }),
  );

  const report = await collectStatus({ paths, env: {} });
  assert.ok(report.drift.some((entry) => entry.includes("Active gateway 1.0.0")));
  assert.ok(report.drift.some((entry) => entry.includes("run setup")));

  const rendered = renderStatusReport(report);
  assert.match(rendered, /drift: Active gateway 1\.0\.0/);
});
