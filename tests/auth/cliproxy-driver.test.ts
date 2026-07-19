import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createCliproxyLoginDriver, type LoginChild } from "../../src/auth/cliproxy-driver.js";
import type { LoginEvent } from "../../src/auth/orchestrator.js";

class FakeLoginChild extends EventEmitter implements LoginChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kills: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal ?? "SIGTERM");
    this.finish();
    return true;
  }

  writeLine(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  finish(code = 0): void {
    if (this.kills.length > 0 || !this.emitted) {
      this.emitted = true;
      this.stdout.end();
      this.stderr.end();
      // Give readline a tick to flush pending lines before exit lands.
      setTimeout(() => this.emit("exit", code), 0);
    }
  }

  private emitted = false;
}

interface Harness {
  readonly child: FakeLoginChild;
  readonly spawnedArgs: string[][];
  collect(mode: "device" | "browser", signal?: AbortSignal): Promise<LoginEvent[]>;
}

function harness(): Harness {
  const child = new FakeLoginChild();
  const spawnedArgs: string[][] = [];
  const driver = createCliproxyLoginDriver({
    binaryFile: "/fixtures/gateway/cli-proxy-api",
    configFile: "/fixtures/claudex/gateway-persistent.yaml",
    spawnFn: (_binary, args) => {
      spawnedArgs.push([...args]);
      return child;
    },
  });
  return {
    child,
    spawnedArgs,
    collect: async (mode, signal = new AbortController().signal) => {
      const events: LoginEvent[] = [];
      for await (const event of driver.start({ mode, signal })) {
        events.push(event);
      }
      return events;
    },
  };
}

test("device flow translates the code prompt and success lines into events", async () => {
  const { child, spawnedArgs, collect } = harness();
  const done = collect("device");
  child.writeLine("Starting Codex device authentication...");
  child.writeLine("Codex device URL: https://auth.openai.com/codex/device");
  child.writeLine("Codex device code: ABCD-1234");
  child.writeLine("Codex authentication successful");
  child.writeLine("Authentication saved to /credentials/user@example.com-plus.json");
  child.writeLine("Codex device authentication successful!");
  child.finish();

  const events = await done;
  assert.deepEqual(events[0], {
    kind: "device_prompt",
    userCode: "ABCD-1234",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresInSeconds: 900,
  });
  assert.deepEqual(events[1], { kind: "persisted" });
  assert.equal(events.length, 2, "duplicate success lines must not repeat the persisted event");
  assert.deepEqual(spawnedArgs[0], [
    "--codex-device-login",
    "--no-browser",
    "--config",
    "/fixtures/claudex/gateway-persistent.yaml",
  ]);
});

test("the saved-path line never reaches an event payload", async () => {
  const { child, collect } = harness();
  const done = collect("device");
  child.writeLine("Codex device code: WXYZ-9876");
  child.writeLine("Authentication saved to /credentials/user@example.com-plus.json");
  child.writeLine("Codex device authentication successful!");
  child.finish();

  const events = await done;
  assert.ok(!JSON.stringify(events).includes("user@example.com"));
});

test("device flow failure line becomes a failed event with detail", async () => {
  const { child, collect } = harness();
  const done = collect("device");
  child.writeLine("Codex device authentication failed: token polling failed with status 400");
  child.finish();

  const events = await done;
  assert.deepEqual(events, [{ kind: "failed", detail: "token polling failed with status 400" }]);
});

test("access_denied failures map to a denied event", async () => {
  const { child, collect } = harness();
  const done = collect("browser");
  child.writeLine("Codex authentication failed: access_denied by the user");
  child.finish();

  const events = await done;
  assert.equal(events[0]?.kind, "denied");
});

test("browser flow emits only a prompt and upstream callback-validation evidence", async () => {
  const { child, spawnedArgs, collect } = harness();
  const done = collect("browser");
  child.writeLine("Visit the following URL to continue authentication:");
  child.writeLine("https://auth.openai.com/oauth/authorize?client_id=x&state=st4te-value");
  child.writeLine("Waiting for Codex authentication callback...");
  child.writeLine("Codex authentication successful!");
  child.finish();

  const events = await done;
  assert.deepEqual(events, [
    { kind: "browser_prompt" },
    { kind: "browser_callback_validated" },
    { kind: "persisted" },
  ]);
  assert.deepEqual(spawnedArgs[0], [
    "--codex-login",
    "--config",
    "/fixtures/claudex/gateway-persistent.yaml",
  ]);
});

test("browser-open output does not require the sensitive authorization URL", async () => {
  const { child, collect } = harness();
  const done = collect("browser");
  child.writeLine("Opening browser for Codex authentication");
  child.writeLine("Waiting for Codex authentication callback...");
  child.writeLine("Codex authentication successful!");
  child.finish();

  assert.deepEqual(await done, [
    { kind: "browser_prompt" },
    { kind: "browser_callback_validated" },
    { kind: "persisted" },
  ]);
});

test("browser flow maps an upstream state rejection without persisting", async () => {
  const { child, collect } = harness();
  const done = collect("browser");
  child.writeLine("Codex authentication failed: OAuth state parameter is invalid");
  child.finish();

  const events = await done;
  assert.equal(events[0]?.kind, "state_mismatch");
  assert.ok(!events.some((event) => event.kind === "persisted"));
});

test("browser flow fails closed when the authorization URL has no state", async () => {
  const { child, collect } = harness();
  const done = collect("browser");
  child.writeLine("Visit the following URL to continue authentication:");
  child.writeLine("https://auth.openai.com/oauth/authorize?client_id=x");
  child.writeLine("Codex authentication successful!");
  child.finish();

  const events = await done;
  assert.equal(events[0]?.kind, "failed");
  assert.ok(!events.some((event) => event.kind === "persisted"));
});

test("an aborted signal terminates the login process", async () => {
  const { child, collect } = harness();
  const controller = new AbortController();
  const done = collect("device", controller.signal);
  child.writeLine("Starting Codex device authentication...");
  controller.abort();

  const events = await done;
  assert.deepEqual(events, []);
  assert.deepEqual(child.kills, ["SIGTERM"]);
});

test("stopping iteration early kills the child instead of leaving it polling", async () => {
  const { child } = harness();
  const driver = createCliproxyLoginDriver({
    binaryFile: "/fixtures/gateway/cli-proxy-api",
    configFile: "/fixtures/claudex/gateway-persistent.yaml",
    spawnFn: () => child,
  });
  const iterator = driver.start({ mode: "device", signal: new AbortController().signal });
  child.writeLine("Codex device code: EARLY-STOP");
  for await (const event of iterator) {
    assert.equal(event.kind, "device_prompt");
    break;
  }
  assert.deepEqual(child.kills, ["SIGTERM"]);
});
