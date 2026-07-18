import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertEmbeddablePath } from "../security/permissions.js";

const execFileAsync = promisify(execFile);

export const CLAUDEX_UNIT_NAME = "claudex-gateway.service";

const MANAGED_MARKER = "# Managed by Claudex";

export interface SystemctlRunner {
  run(args: readonly string[]): Promise<{
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  }>;
}

/** Runs `systemctl --user` for the real service manager. */
export function createSystemctlRunner(): SystemctlRunner {
  return {
    run: async (args) => {
      try {
        const { stdout, stderr } = await execFileAsync("systemctl", ["--user", ...args]);
        return { code: 0, stdout, stderr };
      } catch (error: unknown) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        if (typeof failure.code === "number") {
          return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
        }
        throw error;
      }
    },
  };
}

export type ServiceResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface UnitOptions {
  readonly binaryFile: string;
  readonly configFile: string;
  /** Start the gateway with its embedded model catalog only (--local-model). */
  readonly localModelCatalog?: boolean | undefined;
}

export function renderServiceUnit(options: UnitOptions): string {
  assertEmbeddablePath(options.binaryFile, "the systemd unit");
  assertEmbeddablePath(options.configFile, "the systemd unit");
  return [
    MANAGED_MARKER,
    "# Reinstalling Claudex rewrites this file; manual edits are overwritten.",
    "[Unit]",
    "Description=Claudex managed CLIProxyAPI gateway (loopback only)",
    "After=network.target",
    "",
    "[Service]",
    `ExecStart="${options.binaryFile}" --config "${options.configFile}"${options.localModelCatalog === true ? " --local-model" : ""}`,
    "Restart=on-failure",
    "RestartSec=2",
    "UMask=0077",
    "NoNewPrivileges=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

async function findForeignProxyUnits(unitDir: string): Promise<string[]> {
  const entries = await readdir(unitDir).catch(() => [] as string[]);
  const foreign: string[] = [];
  for (const name of entries.filter(
    (entry) => entry.endsWith(".service") && entry !== CLAUDEX_UNIT_NAME,
  )) {
    const content = await readFile(join(unitDir, name), "utf8").catch(() => "");
    if (content.includes("cli-proxy-api")) {
      foreign.push(name);
    }
  }
  return foreign;
}

export interface InstallServiceOptions {
  readonly unitDir: string;
  readonly binaryFile: string;
  readonly configFile: string;
  readonly runner: SystemctlRunner;
  /** Start the gateway with its embedded model catalog only (--local-model). */
  readonly localModelCatalog?: boolean | undefined;
}

export async function installService(options: InstallServiceOptions): Promise<ServiceResult> {
  // Never take over gateways this manager does not own.
  const foreign = await findForeignProxyUnits(options.unitDir);
  if (foreign.length > 0) {
    return {
      ok: false,
      error: `Refusing to install: existing CLIProxyAPI service(s) found (${foreign.join(", ")}). Claudex never overwrites unrelated gateway installations.`,
    };
  }

  const unitFile = join(options.unitDir, CLAUDEX_UNIT_NAME);
  const existing = await readFile(unitFile, "utf8").catch(() => undefined);
  const existedBefore = existing !== undefined;
  if (existing !== undefined && !existing.includes(MANAGED_MARKER)) {
    return {
      ok: false,
      error: `${CLAUDEX_UNIT_NAME} exists but is not managed by Claudex; refusing to overwrite it.`,
    };
  }

  await mkdir(options.unitDir, { recursive: true });
  await writeFile(
    unitFile,
    renderServiceUnit({
      binaryFile: options.binaryFile,
      configFile: options.configFile,
      localModelCatalog: options.localModelCatalog,
    }),
    { mode: 0o644 },
  );

  const reload = await options.runner.run(["daemon-reload"]);
  const enable =
    reload.code === 0 ? await options.runner.run(["enable", CLAUDEX_UNIT_NAME]) : reload;
  if (enable.code !== 0) {
    // Roll back to the pre-install state so a failed install leaves no unit.
    if (!existedBefore) {
      await rm(unitFile, { force: true });
      await options.runner.run(["daemon-reload"]);
    }
    return {
      ok: false,
      error: `systemctl ${reload.code === 0 ? "enable" : "daemon-reload"} failed: ${enable.stderr.trim() || `exit ${enable.code}`}`,
    };
  }
  return { ok: true };
}

async function isActive(runner: SystemctlRunner): Promise<boolean> {
  const result = await runner.run(["is-active", CLAUDEX_UNIT_NAME]);
  return result.code === 0 && result.stdout.trim() === "active";
}

export async function startService(runner: SystemctlRunner): Promise<ServiceResult> {
  if (await isActive(runner)) {
    return { ok: true };
  }
  const result = await runner.run(["start", CLAUDEX_UNIT_NAME]);
  return result.code === 0
    ? { ok: true }
    : {
        ok: false,
        error: `systemctl start failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
}

export async function stopService(runner: SystemctlRunner): Promise<ServiceResult> {
  if (!(await isActive(runner))) {
    return { ok: true };
  }
  const result = await runner.run(["stop", CLAUDEX_UNIT_NAME]);
  return result.code === 0
    ? { ok: true }
    : {
        ok: false,
        error: `systemctl stop failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
}

export async function restartService(runner: SystemctlRunner): Promise<ServiceResult> {
  const result = await runner.run(["restart", CLAUDEX_UNIT_NAME]);
  return result.code === 0
    ? { ok: true }
    : {
        ok: false,
        error: `systemctl restart failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
}

export interface RemoveServiceOptions {
  readonly unitDir: string;
  readonly runner: SystemctlRunner;
}

export async function removeService(options: RemoveServiceOptions): Promise<ServiceResult> {
  const unitFile = join(options.unitDir, CLAUDEX_UNIT_NAME);
  const existing = await readFile(unitFile, "utf8").catch(() => undefined);
  if (existing === undefined) {
    return { ok: true };
  }
  if (!existing.includes(MANAGED_MARKER)) {
    return {
      ok: false,
      error: `${CLAUDEX_UNIT_NAME} is not managed by Claudex; refusing to remove it.`,
    };
  }
  await options.runner.run(["disable", CLAUDEX_UNIT_NAME]);
  await options.runner.run(["stop", CLAUDEX_UNIT_NAME]);
  await rm(unitFile, { force: true });
  await options.runner.run(["daemon-reload"]);
  return { ok: true };
}

export interface ServiceStatus {
  readonly installedState: string;
  readonly healthy: boolean;
}

export async function serviceStatus(
  runner: SystemctlRunner,
  probe: () => Promise<boolean>,
): Promise<ServiceStatus> {
  const result = await runner.run(["is-active", CLAUDEX_UNIT_NAME]);
  const installedState = result.stdout.trim() || "unknown";
  return { installedState, healthy: await probe() };
}

/** Session mode remains the fallback whenever user systemd is unavailable. */
export async function resolveServiceMode(
  platform: string,
  runner: SystemctlRunner,
): Promise<"systemd" | "session"> {
  if (platform !== "linux") {
    return "session";
  }
  try {
    const result = await runner.run(["show-environment"]);
    return result.code === 0 ? "systemd" : "session";
  } catch {
    return "session";
  }
}
