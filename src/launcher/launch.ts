import { randomBytes } from "node:crypto";
import type { EventEmitter } from "node:events";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectCredentialMetadata } from "../auth/metadata.js";
import type { ClaudexConfig } from "../config/defaults.js";
import { getActiveGateway } from "../gateway/activate.js";
import type { HealthProbe } from "../lifecycle/session.js";
import { buildClaudeEnv } from "../lifecycle/session.js";
import type { ClaudexPaths } from "../platform/paths.js";

export type LaunchFailureReason = "gateway_missing" | "not_logged_in" | "gateway_unhealthy";

export type LaunchPreparation =
  | { readonly ok: true; readonly env: Record<string, string> }
  | { readonly ok: false; readonly reason: LaunchFailureReason; readonly remediation: string };

const REMEDIATIONS: Readonly<Record<LaunchFailureReason, string>> = {
  gateway_missing: "No gateway version is installed and activated. Run setup first.",
  not_logged_in: "No Codex credentials are present. Run login first.",
  gateway_unhealthy:
    "The persistent gateway did not answer on its loopback port. Check the service status or run doctor.",
};

/**
 * Reads or creates the client secret the persistent gateway accepts. Stored
 * owner-only in the state directory; the systemd config references the same
 * value.
 */
export async function ensurePersistentSecret(paths: ClaudexPaths): Promise<string> {
  const file = join(paths.stateDir, "persistent-secret");
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (existing !== undefined && existing.trim().length > 0) {
    return existing.trim();
  }
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(24).toString("hex");
  const handle = await open(file, "w", 0o600);
  try {
    await handle.writeFile(secret, "utf8");
  } finally {
    await handle.close();
  }
  return secret;
}

export interface PrepareLaunchOptions {
  readonly paths: ClaudexPaths;
  readonly config: ClaudexConfig;
  readonly probe: HealthProbe;
}

/** Validates persistent-mode readiness and produces the Claude Code env. */
export async function prepareLaunch(options: PrepareLaunchOptions): Promise<LaunchPreparation> {
  const active = await getActiveGateway(options.paths);
  if (active === undefined) {
    return { ok: false, reason: "gateway_missing", remediation: REMEDIATIONS.gateway_missing };
  }

  const credentials = await inspectCredentialMetadata(options.paths.credentialsDir);
  if (!credentials.present) {
    return { ok: false, reason: "not_logged_in", remediation: REMEDIATIONS.not_logged_in };
  }

  const { host, port } = options.config.runtime;
  const clientSecret = await ensurePersistentSecret(options.paths);
  if (!(await options.probe({ host, port, clientSecret }))) {
    return { ok: false, reason: "gateway_unhealthy", remediation: REMEDIATIONS.gateway_unhealthy };
  }

  return {
    ok: true,
    env: buildClaudeEnv({ host, port, clientSecret, stop: async () => {} }, options.config),
  };
}

/** Minimal child surface for the spawned Claude Code process. */
export interface ClaudeChild extends EventEmitter {
  kill(signal?: NodeJS.Signals): boolean;
}

export type ClaudeSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly env: Record<string, string> },
) => ClaudeChild;

export interface ExecuteClaudeOptions {
  readonly claudeCommand: string;
  readonly args: readonly string[];
  /** Gateway/model overrides layered over the parent environment. */
  readonly env: Record<string, string>;
  readonly baseEnv: Record<string, string | undefined>;
  readonly spawnFn: ClaudeSpawn;
  /** Emits SIGINT/SIGTERM/SIGHUP; defaults to the launcher process itself. */
  readonly signalSource?: EventEmitter;
  /** Runs after Claude Code exits (e.g. stopping a session gateway). */
  readonly cleanup: () => Promise<void>;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

const SIGNAL_EXIT_CODES: Readonly<Partial<Record<string, number>>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

export async function executeClaude(options: ExecuteClaudeOptions): Promise<number> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  Object.assign(merged, options.env);

  const signalSource = options.signalSource ?? process;
  const child = options.spawnFn(options.claudeCommand, options.args, { env: merged });

  const forwarders = FORWARDED_SIGNALS.map((signal) => {
    const forward = (): void => {
      // The launcher never handles the signal itself; Claude Code decides.
      child.kill(signal);
    };
    signalSource.on(signal, forward);
    return { signal, forward };
  });

  const code = await new Promise<number>((resolve) => {
    child.once("exit", (exitCode: number | null, signal: string | null) => {
      resolve(exitCode ?? SIGNAL_EXIT_CODES[signal ?? ""] ?? 1);
    });
  });

  for (const { signal, forward } of forwarders) {
    signalSource.removeListener(signal, forward);
  }
  await options.cleanup();
  return code;
}

/**
 * Diagnoses global Claude Code settings that would fight the per-session
 * environment (custom model or base URL). Read-only: normal `claude`
 * configuration is never modified.
 */
export async function checkGlobalClaudeConflicts(settingsFile: string): Promise<string[]> {
  const raw = await readFile(settingsFile, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const conflicts: string[] = [];
  const settings = parsed as Record<string, unknown>;
  if (typeof settings.model === "string") {
    conflicts.push(
      `Global Claude settings pin "model"; claudex sessions select models per launch and may be overridden.`,
    );
  }
  const env = settings.env;
  if (typeof env === "object" && env !== null) {
    for (const key of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"]) {
      if (key in (env as Record<string, unknown>)) {
        conflicts.push(
          `Global Claude settings set env.${key}, which conflicts with the claudex gateway environment.`,
        );
      }
    }
  }
  return conflicts;
}
