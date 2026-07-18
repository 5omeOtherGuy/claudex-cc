import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLAUDEX_AGENT_PLIST,
  installLaunchAgent,
  type LaunchctlRunner,
  removeLaunchAgent,
  renderLaunchAgentPlist,
  resolveDarwinServiceMode,
} from "../../src/lifecycle/launchd.js";

// Rendered plists embed POSIX fixture paths; Windows temp paths contain
// backslashes the embeddable-path guard rightly rejects.
const skipOnWindows = { skip: process.platform === "win32" };

const BINARY = "/fixtures/claudex/gateway/cli-proxy-api";
const CONFIG = "/fixtures/claudex/gateway-persistent.yaml";

function recordingRunner(calls: string[][], failOn?: string): LaunchctlRunner {
  return {
    run: async (args) => {
      calls.push([...args]);
      if (failOn !== undefined && args[0] === failOn) {
        return { code: 1, stdout: "", stderr: `${failOn} refused` };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("the rendered launch agent is managed, owner-only via umask, and restart-safe", () => {
  const plist = renderLaunchAgentPlist({ binaryFile: BINARY, configFile: CONFIG });
  assert.match(plist, /Managed by Claudex/);
  assert.match(plist, /<string>com\.claudex\.gateway<\/string>/);
  assert.match(plist, new RegExp(`<string>${BINARY}</string>`));
  assert.match(plist, /<string>--config<\/string>/);
  assert.match(plist, /<key>Umask<\/key>\s*<integer>63<\/integer>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.doesNotMatch(plist, /--local-model/);

  const local = renderLaunchAgentPlist({
    binaryFile: BINARY,
    configFile: CONFIG,
    localModelCatalog: true,
  });
  assert.match(local, /<string>--local-model<\/string>/);
});

test("plist rendering escapes XML and refuses non-embeddable paths", () => {
  const spaced = renderLaunchAgentPlist({
    binaryFile: "/Applications/My Tools & Bin/cli-proxy-api",
    configFile: CONFIG,
  });
  assert.match(spaced, /My Tools &amp; Bin/);

  assert.throws(
    () => renderLaunchAgentPlist({ binaryFile: '/bad/"quoted"/bin', configFile: CONFIG }),
    /refusing/i,
  );
});

test(
  "install writes the plist and bootstraps the gui domain idempotently",
  skipOnWindows,
  async () => {
    const agentDir = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
    const calls: string[][] = [];
    const runner = recordingRunner(calls);

    const first = await installLaunchAgent({
      agentDir,
      binaryFile: BINARY,
      configFile: CONFIG,
      runner,
      uid: 501,
    });
    assert.equal(first.ok, true);
    const plist = await readFile(join(agentDir, CLAUDEX_AGENT_PLIST), "utf8");
    assert.match(plist, /Managed by Claudex/);
    assert.deepEqual(calls[0], ["bootout", "gui/501/com.claudex.gateway"]);
    assert.deepEqual(calls[1], ["bootstrap", "gui/501", join(agentDir, CLAUDEX_AGENT_PLIST)]);

    const second = await installLaunchAgent({
      agentDir,
      binaryFile: BINARY,
      configFile: CONFIG,
      runner,
      uid: 501,
    });
    assert.equal(second.ok, true, "reinstalling the managed agent is idempotent");
  },
);

test("install refuses foreign proxy agents and unmanaged plists", skipOnWindows, async () => {
  const agentDir = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "org.other.proxy.plist"),
    "<plist><string>/opt/cli-proxy-api</string></plist>",
  );

  const foreign = await installLaunchAgent({
    agentDir,
    binaryFile: BINARY,
    configFile: CONFIG,
    runner: recordingRunner([]),
    uid: 501,
  });
  assert.equal(foreign.ok, false);
  assert.match(foreign.ok ? "" : foreign.error, /never overwrites unrelated/);

  const agentDir2 = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
  await mkdir(agentDir2, { recursive: true });
  await writeFile(join(agentDir2, CLAUDEX_AGENT_PLIST), "<plist>user-owned</plist>");
  const unmanaged = await installLaunchAgent({
    agentDir: agentDir2,
    binaryFile: BINARY,
    configFile: CONFIG,
    runner: recordingRunner([]),
    uid: 501,
  });
  assert.equal(unmanaged.ok, false);
  assert.match(unmanaged.ok ? "" : unmanaged.error, /not managed by Claudex/);
  assert.equal(
    await readFile(join(agentDir2, CLAUDEX_AGENT_PLIST), "utf8"),
    "<plist>user-owned</plist>",
  );
});

test("a failed bootstrap removes the freshly written plist", skipOnWindows, async () => {
  const agentDir = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
  const result = await installLaunchAgent({
    agentDir,
    binaryFile: BINARY,
    configFile: CONFIG,
    runner: recordingRunner([], "bootstrap"),
    uid: 501,
  });
  assert.equal(result.ok, false);
  await assert.rejects(readFile(join(agentDir, CLAUDEX_AGENT_PLIST), "utf8"));
});

test(
  "remove boots the agent out, deletes managed plists, and is idempotent",
  skipOnWindows,
  async () => {
    const agentDir = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
    const calls: string[][] = [];
    const runner = recordingRunner(calls);
    await installLaunchAgent({
      agentDir,
      binaryFile: BINARY,
      configFile: CONFIG,
      runner,
      uid: 501,
    });

    const removed = await removeLaunchAgent({ agentDir, runner, uid: 501 });
    assert.equal(removed.ok, true);
    await assert.rejects(readFile(join(agentDir, CLAUDEX_AGENT_PLIST), "utf8"));
    assert.ok(calls.some((call) => call[0] === "bootout"));

    const again = await removeLaunchAgent({ agentDir, runner, uid: 501 });
    assert.equal(again.ok, true);
  },
);

test("remove refuses unmanaged plists", async () => {
  const agentDir = join(await mkdtemp(join(tmpdir(), "claudex-launchd-")), "LaunchAgents");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, CLAUDEX_AGENT_PLIST), "<plist>user-owned</plist>");

  const result = await removeLaunchAgent({ agentDir, runner: recordingRunner([]), uid: 501 });
  assert.equal(result.ok, false);
  assert.equal(
    await readFile(join(agentDir, CLAUDEX_AGENT_PLIST), "utf8"),
    "<plist>user-owned</plist>",
  );
});

test("darwin service mode requires a reachable gui domain", async () => {
  assert.equal(await resolveDarwinServiceMode(recordingRunner([]), 501), "launchd");
  assert.equal(await resolveDarwinServiceMode(recordingRunner([], "print"), 501), "session");
});
