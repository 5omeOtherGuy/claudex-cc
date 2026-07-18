import assert from "node:assert/strict";
import test from "node:test";
import type { LaunchctlRunner } from "../../src/lifecycle/launchd.js";
import { resolvePersistentService } from "../../src/lifecycle/service.js";
import type { SystemctlRunner } from "../../src/lifecycle/systemd.js";

const okSystemctl: SystemctlRunner = {
  run: async () => ({ code: 0, stdout: "", stderr: "" }),
};

const okLaunchctl: LaunchctlRunner = {
  run: async () => ({ code: 0, stdout: "", stderr: "" }),
};

test("linux with user systemd resolves to the systemd manager", async () => {
  const service = await resolvePersistentService({
    platform: "linux",
    unitDir: "/fixtures/systemd",
    systemctl: okSystemctl,
  });
  assert.equal(service?.kind, "systemd");
});

test("linux without user systemd falls back to session mode", async () => {
  const service = await resolvePersistentService({
    platform: "linux",
    unitDir: "/fixtures/systemd",
    systemctl: { run: async () => ({ code: 1, stdout: "", stderr: "" }) },
  });
  assert.equal(service, undefined);
});

test("darwin with a reachable gui domain resolves to the launchd manager", async () => {
  const service = await resolvePersistentService({
    platform: "darwin",
    unitDir: "/fixtures/systemd",
    agentDir: "/fixtures/LaunchAgents",
    launchctl: okLaunchctl,
    uid: 501,
  });
  assert.equal(service?.kind, "launchd");
});

test("darwin without an agent directory or gui domain falls back to session mode", async () => {
  assert.equal(
    await resolvePersistentService({
      platform: "darwin",
      unitDir: "/fixtures/systemd",
      launchctl: okLaunchctl,
    }),
    undefined,
  );
  assert.equal(
    await resolvePersistentService({
      platform: "darwin",
      unitDir: "/fixtures/systemd",
      agentDir: "/fixtures/LaunchAgents",
      launchctl: { run: async () => ({ code: 1, stdout: "", stderr: "" }) },
      uid: 501,
    }),
    undefined,
  );
});

test("platforms without a service manager fall back to session mode", async () => {
  assert.equal(
    await resolvePersistentService({ platform: "win32", unitDir: "/fixtures/systemd" }),
    undefined,
  );
});
