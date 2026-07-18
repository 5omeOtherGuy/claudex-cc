import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DoctorFetch } from "../../src/commands/doctor.js";
import { renderDoctorReport, runDoctor } from "../../src/commands/doctor.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { GATEWAY_MANIFEST } from "../../src/gateway/manifest.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-doc-"));
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

async function installFixtures(paths: ClaudexPaths): Promise<void> {
  const versionDir = join(paths.dataDir, "gateway", "versions", GATEWAY_MANIFEST.version);
  await mkdir(versionDir, { recursive: true });
  const binary = join(versionDir, "cli-proxy-api");
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(
    join(paths.dataDir, "gateway", "active.json"),
    JSON.stringify({ version: GATEWAY_MANIFEST.version, binaryFile: binary }),
  );
  await mkdir(paths.credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(paths.credentialsDir, "codex.json"),
    JSON.stringify({ access_token: "fake-token-value", expired: "2027-01-01T00:00:00Z" }),
    { mode: 0o600 },
  );
}

const SECRET = "s".repeat(48);

function fakeFetch(log: string[]): DoctorFetch {
  return async (url, init) => {
    log.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.endsWith("/v1/models")) {
      return {
        status: 200,
        bodyText: async () =>
          JSON.stringify({ data: [{ id: DEFAULT_CONFIG.models.main }, { id: "other-model" }] }),
      };
    }
    return { status: 200, bodyText: async () => "{}" };
  };
}

test("doctor on an empty machine fails with one remediation per failing check", async () => {
  const paths = await makePaths();
  const report = await runDoctor({
    paths,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.19.0",
    offline: true,
  });

  assert.equal(report.overall, "fail");
  for (const check of report.checks) {
    if (check.status === "fail") {
      assert.ok(check.remediation !== undefined, `${check.name} must carry a remediation`);
    }
  }
  const byName = new Map(report.checks.map((check) => [check.name, check]));
  assert.equal(byName.get("gateway-installed")?.status, "fail");
  assert.equal(byName.get("credentials")?.status, "fail");
  assert.equal(byName.get("gateway-health")?.status, "skip");
  assert.equal(byName.get("live-inference")?.status, "skip");
});

test("doctor check order is stable for JSON consumers", async () => {
  const paths = await makePaths();
  const report = await runDoctor({
    paths,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.19.0",
    offline: true,
  });
  assert.deepEqual(
    report.checks.map((check) => check.name),
    [
      "node-version",
      "platform-supported",
      "config-valid",
      "state-permissions",
      "gateway-installed",
      "bind-address",
      "credentials",
      "claude-settings-conflicts",
      "gateway-health",
      "model-inventory",
      "token-counting",
      "live-inference",
    ],
  );
});

test("a healthy gateway passes health, inventory, and token counting", async () => {
  const paths = await makePaths();
  await installFixtures(paths);
  const log: string[] = [];

  const report = await runDoctor({
    paths,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.19.0",
    fetchFn: fakeFetch(log),
    clientSecret: SECRET,
  });

  const byName = new Map(report.checks.map((check) => [check.name, check]));
  assert.equal(byName.get("gateway-health")?.status, "pass");
  assert.equal(byName.get("model-inventory")?.status, "pass");
  assert.equal(byName.get("token-counting")?.status, "pass");
  assert.equal(byName.get("live-inference")?.status, "skip");
  assert.ok(
    !log.some((entry) => entry === "POST /v1/messages"),
    "no inference without explicit consent",
  );
  // Not asserting report.overall here: state-permissions inspects the real
  // host filesystem, which differs on the Windows/macOS CI runners.
});

test("live inference runs only with explicit consent and stays bounded", async () => {
  const paths = await makePaths();
  await installFixtures(paths);
  let inferenceBody: string | undefined;
  const fetchFn: DoctorFetch = async (url, init) => {
    if (url.endsWith("/v1/messages") && init.method === "POST") {
      inferenceBody = init.body;
    }
    if (url.endsWith("/v1/models")) {
      return {
        status: 200,
        bodyText: async () => JSON.stringify({ data: [{ id: DEFAULT_CONFIG.models.main }] }),
      };
    }
    return { status: 200, bodyText: async () => "{}" };
  };

  const report = await runDoctor({
    paths,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.19.0",
    fetchFn,
    clientSecret: SECRET,
    allowLiveInference: true,
  });

  const live = report.checks.find((check) => check.name === "live-inference");
  assert.equal(live?.status, "pass");
  assert.ok(inferenceBody !== undefined);
  const parsed = JSON.parse(inferenceBody) as { max_tokens: number };
  assert.ok(parsed.max_tokens <= 16, "live inference must stay bounded");
});

test("doctor output never contains secrets or token material", async () => {
  const paths = await makePaths();
  await installFixtures(paths);
  const report = await runDoctor({
    paths,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.19.0",
    fetchFn: fakeFetch([]),
    clientSecret: SECRET,
  });

  const serialized = JSON.stringify(report) + renderDoctorReport(report);
  assert.doesNotMatch(serialized, /fake-token-value/);
  assert.ok(!serialized.includes(SECRET), "client secret must never appear in diagnostics");
});

test("old node versions and unsupported platforms fail with remediation", async () => {
  const paths = await makePaths();
  const report = await runDoctor({
    paths,
    platform: "sunos",
    arch: "x64",
    nodeVersion: "v20.11.0",
    offline: true,
  });
  const byName = new Map(report.checks.map((check) => [check.name, check]));
  assert.equal(byName.get("node-version")?.status, "fail");
  assert.equal(byName.get("platform-supported")?.status, "fail");
  assert.ok(byName.get("platform-supported")?.remediation?.includes("sunos"));
});
