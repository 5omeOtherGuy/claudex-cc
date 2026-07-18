import { randomBytes } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { ClaudexConfig } from "../config/defaults.js";
import type { ClaudexPaths } from "../platform/paths.js";
import { ensureOwnerOnlyDir } from "../security/permissions.js";

export interface LaunchRequest {
  readonly binaryFile: string;
  readonly host: string;
  readonly port: number;
  readonly clientSecret: string;
  readonly paths: ClaudexPaths;
}

/** Minimal child-process surface the lifecycle needs; satisfied by node:child_process. */
export interface GatewayProcess {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
  once(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
}

export interface GatewayLauncher {
  launch(request: LaunchRequest): Promise<GatewayProcess>;
}

/** Returns true once the gateway answers on its loopback address. */
export type HealthProbe = (target: {
  readonly host: string;
  readonly port: number;
  readonly clientSecret: string;
}) => Promise<boolean>;

export interface SessionHandle {
  readonly host: string;
  readonly port: number;
  readonly clientSecret: string;
  stop(options?: { readonly graceMs?: number }): Promise<void>;
}

export type SessionFailureReason = "port_conflict" | "startup_timeout" | "crashed";

export type SessionStartResult =
  | { readonly ok: true; readonly session: SessionHandle }
  | {
      readonly ok: false;
      readonly reason: SessionFailureReason;
      readonly error: string;
    };

export interface SessionOptions {
  readonly paths: ClaudexPaths;
  readonly config: ClaudexConfig;
  readonly binaryFile: string;
  readonly launcher: GatewayLauncher;
  readonly probe: HealthProbe;
  /** 0 selects a free ephemeral loopback port. */
  readonly port?: number;
  readonly probeIntervalMs?: number;
  readonly startupTimeoutMs?: number;
}

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_INTERVAL_MS = 250;
const DEFAULT_STOP_GRACE_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Removes bookkeeping left behind by crashed sessions. Only files whose
 * recorded owner pid is no longer alive are removed; nothing is ever
 * signalled based on recorded pids.
 */
async function cleanupStaleSessions(sessionsDir: string): Promise<void> {
  const entries = await readdir(sessionsDir).catch(() => [] as string[]);
  for (const name of entries.filter((entry) => entry.endsWith(".json"))) {
    const file = join(sessionsDir, name);
    let stale = true;
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      const pid =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>).pid
          : undefined;
      stale = typeof pid !== "number" || !isPidAlive(pid);
    } catch {
      // Unreadable bookkeeping is stale by definition.
    }
    if (stale) {
      await rm(file, { force: true });
      await rm(join(sessionsDir, name.replace(/^session-(\d+)\.json$/, "gateway-$1.yaml")), {
        force: true,
      });
    }
  }
}

/**
 * Binds the requested loopback port once to validate availability (or to let
 * the OS pick a free one), then releases it for the gateway to claim.
 */
async function reservePort(requested: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(undefined));
    server.listen(requested, LOOPBACK_HOST, () => {
      const address = server.address();
      const port = address !== null && typeof address === "object" ? address.port : undefined;
      server.close(() => resolve(port));
    });
  });
}

export async function startSessionGateway(options: SessionOptions): Promise<SessionStartResult> {
  const requestedPort = options.port ?? options.config.runtime.port;
  const port = await reservePort(requestedPort);
  if (port === undefined) {
    return {
      ok: false,
      reason: "port_conflict",
      error: `Port ${requestedPort} on ${LOOPBACK_HOST} is already in use. Stop the conflicting process or configure a different runtime.port.`,
    };
  }

  // Per-session credential; the gateway only accepts requests carrying it.
  const clientSecret = randomBytes(24).toString("hex");

  const sessionsDir = join(options.paths.stateDir, "sessions");
  await ensureOwnerOnlyDir(sessionsDir);
  await cleanupStaleSessions(sessionsDir);

  const child = await options.launcher.launch({
    binaryFile: options.binaryFile,
    host: LOOPBACK_HOST,
    port,
    clientSecret,
    paths: options.paths,
  });

  let exited = false;
  let exitCode: number | null = null;
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const stateFile = join(sessionsDir, `session-${port}.json`);
  await writeFile(stateFile, `${JSON.stringify({ pid: process.pid, port }, null, 2)}\n`, {
    mode: 0o600,
  });

  const stop = async (stopOptions?: { readonly graceMs?: number }): Promise<void> => {
    await rm(stateFile, { force: true });
    if (exited) {
      return;
    }
    const graceMs = stopOptions?.graceMs ?? DEFAULT_STOP_GRACE_MS;
    const gone = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    // Only the child we spawned is ever signalled; nothing is killed by pid.
    child.kill("SIGTERM");
    const timely = await Promise.race([gone.then(() => true), delay(graceMs).then(() => false)]);
    if (!timely) {
      child.kill("SIGKILL");
      // Bounded final wait: a child that already exited will never emit again.
      await Promise.race([gone, delay(graceMs)]);
    }
    exited = true;
  };

  const deadline = Date.now() + (options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  const interval = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  while (Date.now() < deadline) {
    if (exited) {
      await rm(stateFile, { force: true });
      return {
        ok: false,
        reason: "crashed",
        error: `The gateway exited during startup (code ${exitCode ?? "unknown"}). Run doctor for diagnostics.`,
      };
    }
    if (await options.probe({ host: LOOPBACK_HOST, port, clientSecret })) {
      return { ok: true, session: { host: LOOPBACK_HOST, port, clientSecret, stop } };
    }
    await delay(interval);
  }

  await stop({ graceMs: 1_000 });
  return {
    ok: false,
    reason: "startup_timeout",
    error: "The gateway did not become healthy within the startup timeout and was terminated.",
  };
}

/**
 * Environment for the Claude Code child process. Contains the loopback
 * gateway address, the per-session secret, and model routing — never
 * credential paths or provider tokens.
 */
export function buildClaudeEnv(
  session: SessionHandle,
  config: ClaudexConfig,
): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: `http://${session.host}:${session.port}`,
    ANTHROPIC_AUTH_TOKEN: session.clientSecret,
    ANTHROPIC_MODEL: config.models.main,
    ANTHROPIC_SMALL_FAST_MODEL: config.models.subagent,
  };
}
