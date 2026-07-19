import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthValidator, LoginDriver, LoginEvent } from "../../src/auth/orchestrator.js";
import { runLogin } from "../../src/auth/orchestrator.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-auth-"));
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

function driverOf(events: readonly LoginEvent[]): LoginDriver {
  return {
    // biome-ignore lint/correctness/useYield: sync fixture
    async *start() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

const passingValidator: AuthValidator = {
  checkPersisted: async () => ({ ok: true }),
  probe: async () => ({ ok: true }),
};

const DEVICE_PROMPT: LoginEvent = {
  kind: "device_prompt",
  userCode: "ABCD-1234",
  verificationUrl: "https://auth.example.invalid/device",
  expiresInSeconds: 600,
};

test("device flow success requires persistence plus authenticated validation", async () => {
  const paths = await makePaths();
  const probes: string[] = [];
  const validator: AuthValidator = {
    checkPersisted: async () => {
      probes.push("persisted");
      return { ok: true };
    },
    probe: async () => {
      probes.push("probe");
      return { ok: true };
    },
  };

  const result = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "persisted" }]),
    validator,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(probes, ["persisted", "probe"]);
});

test("a persisted event without an actual credential file fails closed", async () => {
  const paths = await makePaths();
  const validator: AuthValidator = {
    checkPersisted: async () => ({ ok: false, detail: "no credential file" }),
    probe: async () => ({ ok: true }),
  };

  const result = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "persisted" }]),
    validator,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "persistence");
});

test("a failing authenticated probe reports validation failure with remediation", async () => {
  const paths = await makePaths();
  const validator: AuthValidator = {
    checkPersisted: async () => ({ ok: true }),
    probe: async () => ({ ok: false, status: "unauthorized", detail: "401" }),
  };

  const result = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "persisted" }]),
    validator,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "validation");
  assert.ok(!result.ok && result.remediation.length > 0);
});

test("denial maps to a denied result with remediation", async () => {
  const paths = await makePaths();
  const result = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "denied", detail: "user rejected" }]),
    validator: passingValidator,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "denied");
});

test("entitlement failures surface as their own reason", async () => {
  const paths = await makePaths();
  const result = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "entitlement_error", detail: "no Codex plan" }]),
    validator: passingValidator,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "entitlement");
});

test("browser flow rejects persistence without callback-validation evidence", async () => {
  const paths = await makePaths();
  const result = await runLogin({
    paths,
    mode: "browser",
    driver: driverOf([{ kind: "browser_prompt" }, { kind: "persisted" }]),
    validator: passingValidator,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "state_mismatch");
});

test("browser flow accepts upstream callback-validation evidence", async () => {
  const paths = await makePaths();
  const result = await runLogin({
    paths,
    mode: "browser",
    driver: driverOf([
      { kind: "browser_prompt" },
      { kind: "browser_callback_validated" },
      { kind: "persisted" },
    ]),
    validator: passingValidator,
  });

  assert.equal(result.ok, true);
});

test("a hanging driver times out with a bounded deadline", async () => {
  const paths = await makePaths();
  const hangingDriver: LoginDriver = {
    async *start({ signal }) {
      yield DEVICE_PROMPT;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  };

  const result = await runLogin({
    paths,
    mode: "device",
    driver: hangingDriver,
    validator: passingValidator,
    timeoutMs: 25,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "timeout");
});

test("a second login while one is active fails closed as locked", async () => {
  const paths = await makePaths();
  let resolveFirst: (() => void) | undefined;
  const blocking: LoginDriver = {
    async *start() {
      yield DEVICE_PROMPT;
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      yield { kind: "persisted" } as const;
    },
  };

  const first = runLogin({ paths, mode: "device", driver: blocking, validator: passingValidator });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "persisted" }]),
    validator: passingValidator,
  });

  assert.equal(second.ok, false);
  assert.ok(!second.ok && second.reason === "locked");

  resolveFirst?.();
  assert.equal((await first).ok, true);
});

test("progress output never contains token-like material", async () => {
  const paths = await makePaths();
  const progress: string[] = [];
  await runLogin({
    paths,
    mode: "device",
    driver: driverOf([DEVICE_PROMPT, { kind: "persisted" }]),
    validator: passingValidator,
    onProgress: (message) => progress.push(message),
  });

  assert.ok(progress.length > 0, "expected bounded, actionable progress");
  const joined = progress.join("\n");
  assert.match(joined, /ABCD-1234/, "device user code is meant for display");
  assert.doesNotMatch(joined, /access_token|refresh_token|code=/i);
});
