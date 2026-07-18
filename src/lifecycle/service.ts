import {
  createLaunchctlRunner,
  installLaunchAgent,
  type LaunchctlRunner,
  removeLaunchAgent,
  resolveDarwinServiceMode,
  restartLaunchAgent,
  startLaunchAgent,
} from "./launchd.js";
import {
  createSystemctlRunner,
  installService,
  removeService,
  resolveServiceMode,
  restartService,
  type ServiceResult,
  type SystemctlRunner,
  startService,
} from "./systemd.js";

export interface PersistentServiceDeps {
  readonly platform: string;
  /** systemd user-unit directory (Linux). */
  readonly unitDir: string;
  readonly systemctl?: SystemctlRunner | undefined;
  /** LaunchAgent directory, typically ~/Library/LaunchAgents (macOS). */
  readonly agentDir?: string | undefined;
  readonly launchctl?: LaunchctlRunner | undefined;
  readonly uid?: number | undefined;
}

export interface PersistentInstallRequest {
  readonly binaryFile: string;
  readonly configFile: string;
  readonly localModelCatalog?: boolean | undefined;
}

/** Uniform persistent-service surface over systemd (Linux) and launchd (macOS). */
export interface PersistentService {
  readonly kind: "systemd" | "launchd";
  install(request: PersistentInstallRequest): Promise<ServiceResult>;
  start(): Promise<ServiceResult>;
  restart(): Promise<ServiceResult>;
  remove(): Promise<ServiceResult>;
}

function defaultUid(): number {
  return process.getuid?.() ?? 0;
}

/**
 * Returns the platform's persistent-service manager, or undefined when the
 * platform has none (or its per-user service domain is unreachable) — the
 * caller then falls back to session-mode launches.
 */
export async function resolvePersistentService(
  deps: PersistentServiceDeps,
): Promise<PersistentService | undefined> {
  if (deps.platform === "linux") {
    const runner = deps.systemctl ?? createSystemctlRunner();
    if ((await resolveServiceMode(deps.platform, runner)) !== "systemd") {
      return undefined;
    }
    return {
      kind: "systemd",
      install: (request) =>
        installService({
          unitDir: deps.unitDir,
          binaryFile: request.binaryFile,
          configFile: request.configFile,
          localModelCatalog: request.localModelCatalog,
          runner,
        }),
      start: () => startService(runner),
      restart: () => restartService(runner),
      remove: () => removeService({ unitDir: deps.unitDir, runner }),
    };
  }

  if (deps.platform === "darwin" && deps.agentDir !== undefined) {
    const agentDir = deps.agentDir;
    const runner = deps.launchctl ?? createLaunchctlRunner();
    const uid = deps.uid ?? defaultUid();
    if ((await resolveDarwinServiceMode(runner, uid)) !== "launchd") {
      return undefined;
    }
    return {
      kind: "launchd",
      install: (request) =>
        installLaunchAgent({
          agentDir,
          binaryFile: request.binaryFile,
          configFile: request.configFile,
          localModelCatalog: request.localModelCatalog,
          runner,
          uid,
        }),
      start: () => startLaunchAgent(runner, uid),
      restart: () => restartLaunchAgent(runner, uid),
      remove: () => removeLaunchAgent({ agentDir, runner, uid }),
    };
  }

  return undefined;
}
