import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";
import {
  CLAUDEX_UNIT_NAME,
  installService,
  removeService,
  renderServiceUnit,
  resolveServiceMode,
  serviceStatus,
  startService,
  stopService,
} from "../../src/lifecycle/systemd.js";

interface Call {
  readonly args: readonly string[];
}

function fakeRunner(
  responses: Partial<Record<string, { code: number; stdout?: string }>> = {},
): SystemctlRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (args) => {
      calls.push({ args });
      const key = args.join(" ");
      for (const [prefix, response] of Object.entries(responses)) {
        if (response !== undefined && key.startsWith(prefix)) {
          return { code: response.code, stdout: response.stdout ?? "", stderr: "" };
        }
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function makeDirs(): Promise<{ unitDir: string; configFile: string }> {
  const root = await mkdtemp(join(tmpdir(), "claudex-sysd-"));
  const unitDir = join(root, "systemd", "user");
  const configFile = join(root, "gateway-persistent.yaml");
  await writeFile(configFile, 'host: "127.0.0.1"\n');
  return { unitDir, configFile };
}

const BINARY = "/opt/claudex/cli-proxy-api";

test("the rendered unit uses validated paths, umask 077, and a claudex marker", () => {
  const unit = renderServiceUnit({ binaryFile: BINARY, configFile: "/etc/x/gw.yaml" });
  assert.match(unit, /# Managed by Claudex/);
  assert.match(unit, /UMask=0077/);
  assert.ok(unit.includes(`ExecStart=${BINARY} --config /etc/x/gw.yaml`));
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("install writes the unit, reloads, and enables; reinstall is idempotent", async () => {
  const { unitDir, configFile } = await makeDirs();
  const runner = fakeRunner();

  const first = await installService({ unitDir, binaryFile: BINARY, configFile, runner });
  assert.equal(first.ok, true);
  const unitFile = join(unitDir, CLAUDEX_UNIT_NAME);
  assert.match(await readFile(unitFile, "utf8"), /Managed by Claudex/);
  assert.ok(runner.calls.some((c) => c.args.join(" ") === "daemon-reload"));
  assert.ok(runner.calls.some((c) => c.args.join(" ") === `enable ${CLAUDEX_UNIT_NAME}`));

  const second = await installService({ unitDir, binaryFile: BINARY, configFile, runner });
  assert.equal(second.ok, true, "reinstalling our own unit must be idempotent");
});

test("a foreign unit running cli-proxy-api is detected and never overwritten", async () => {
  const { unitDir, configFile } = await makeDirs();
  await mkdir(unitDir, { recursive: true });
  const foreign = join(unitDir, "my-own-proxy.service");
  await writeFile(
    foreign,
    "[Service]\nExecStart=/usr/local/bin/cli-proxy-api --config /home/u/cfg.yaml\n",
  );

  const runner = fakeRunner();
  const result = await installService({ unitDir, binaryFile: BINARY, configFile, runner });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /my-own-proxy\.service/.test(result.error));
  assert.equal((await readFile(foreign, "utf8")).includes("Managed by Claudex"), false);
  await assert.rejects(stat(join(unitDir, CLAUDEX_UNIT_NAME)), "our unit must not be written");
});

test("a claudex unit whose name was claimed by someone else fails closed", async () => {
  const { unitDir, configFile } = await makeDirs();
  await mkdir(unitDir, { recursive: true });
  await writeFile(join(unitDir, CLAUDEX_UNIT_NAME), "[Service]\nExecStart=/usr/bin/other\n");

  const runner = fakeRunner();
  const result = await installService({ unitDir, binaryFile: BINARY, configFile, runner });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /not managed by claudex/i.test(result.error));
});

test("enable failure rolls back the written unit file", async () => {
  const { unitDir, configFile } = await makeDirs();
  const runner = fakeRunner({ enable: { code: 1 } });

  const result = await installService({ unitDir, binaryFile: BINARY, configFile, runner });
  assert.equal(result.ok, false);
  const remaining = await readdir(unitDir).catch(() => []);
  assert.deepEqual(remaining, [], "failed install must not leave a unit behind");
});

test("start and stop are idempotent based on active state", async () => {
  const active = fakeRunner({ "is-active": { code: 0, stdout: "active" } });
  const started = await startService(active);
  assert.equal(started.ok, true);
  assert.ok(
    !active.calls.some((c) => c.args[0] === "start"),
    "an active service is not started again",
  );

  const inactive = fakeRunner({ "is-active": { code: 3, stdout: "inactive" } });
  const stopped = await stopService(inactive);
  assert.equal(stopped.ok, true);
  assert.ok(
    !inactive.calls.some((c) => c.args[0] === "stop"),
    "an inactive service is not stopped again",
  );
});

test("removal disables, deletes, and reloads; removing an absent unit is idempotent", async () => {
  const { unitDir, configFile } = await makeDirs();
  const runner = fakeRunner();
  await installService({ unitDir, binaryFile: BINARY, configFile, runner });

  const removed = await removeService({ unitDir, runner });
  assert.equal(removed.ok, true);
  await assert.rejects(stat(join(unitDir, CLAUDEX_UNIT_NAME)));

  const again = await removeService({ unitDir, runner });
  assert.equal(again.ok, true, "removing an absent unit must succeed");
});

test("status reports active state and health from the injected probe", async () => {
  const runner = fakeRunner({ "is-active": { code: 0, stdout: "active" } });
  const status = await serviceStatus(runner, async () => true);
  assert.deepEqual(status, { installedState: "active", healthy: true });

  const down = fakeRunner({ "is-active": { code: 3, stdout: "inactive" } });
  const downStatus = await serviceStatus(down, async () => false);
  assert.deepEqual(downStatus, { installedState: "inactive", healthy: false });
});

test("session mode remains available when systemd is absent or declined", async () => {
  const noSystemd: SystemctlRunner = {
    run: async () => {
      throw new Error("systemctl: command not found");
    },
  };
  assert.equal(await resolveServiceMode("linux", noSystemd), "session");
  assert.equal(await resolveServiceMode("darwin", fakeRunner()), "session");
  assert.equal(await resolveServiceMode("win32", fakeRunner()), "session");
  assert.equal(await resolveServiceMode("linux", fakeRunner()), "systemd");
});
