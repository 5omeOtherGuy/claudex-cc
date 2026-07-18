import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudexConfig } from "../config/defaults.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { activateGatewayVersion } from "../gateway/activate.js";
import { type Downloader, type Extractor, installGatewayVersion } from "../gateway/install.js";
import { GATEWAY_MANIFEST, type GatewayManifest, selectArtifact } from "../gateway/manifest.js";
import { ensurePersistentSecret } from "../launcher/launch.js";
import { installShim, shimFileName } from "../launcher/shim.js";
import { defaultHealthProbe, writePersistentConfig } from "../lifecycle/cliproxy.js";
import type { HealthProbe } from "../lifecycle/session.js";
import {
  createSystemctlRunner,
  installService,
  resolveServiceMode,
  type SystemctlRunner,
  startService,
} from "../lifecycle/systemd.js";
import type { ClaudexPaths } from "../platform/paths.js";

export type SetupStepStatus = "ok" | "skipped" | "failed";

export interface SetupStep {
  readonly name: string;
  readonly status: SetupStepStatus;
  readonly detail: string;
}

export interface SetupReport {
  readonly ok: boolean;
  readonly steps: readonly SetupStep[];
  readonly relaunchRequired: boolean;
}

export interface SetupOptions {
  readonly paths: ClaudexPaths;
  readonly platform: string;
  readonly arch: string;
  /** Directory for the stable `claudex` shim (ADR 0002). */
  readonly binDir: string;
  /** Absolute path of the manager CLI entry the shim delegates to. */
  readonly managerEntry: string;
  /** systemd user-unit directory; only used on Linux persistent mode. */
  readonly unitDir: string;
  readonly manifest?: GatewayManifest;
  readonly downloader?: Downloader;
  readonly extractor?: Extractor;
  readonly runner?: SystemctlRunner;
  readonly probe?: HealthProbe;
}

interface StepList {
  push(step: SetupStep): void;
}

async function ensureConfig(
  paths: ClaudexPaths,
  steps: StepList,
): Promise<ClaudexConfig | undefined> {
  const loaded = await loadConfig(paths);
  if (!loaded.ok) {
    steps.push({ name: "config", status: "failed", detail: loaded.error });
    return undefined;
  }
  if (loaded.source === "defaults") {
    await saveConfig(paths, loaded.config);
    steps.push({
      name: "config",
      status: "ok",
      detail: `Created ${paths.configFile} with defaults.`,
    });
  } else {
    steps.push({ name: "config", status: "ok", detail: `Using ${paths.configFile}.` });
  }
  return loaded.config;
}

async function ensureGatewayInstalled(
  options: SetupOptions,
  config: ClaudexConfig,
  manifest: GatewayManifest,
  steps: StepList,
): Promise<boolean> {
  if (config.gateway.version !== manifest.version) {
    steps.push({
      name: "gateway-install",
      status: "failed",
      detail: `Config pins gateway ${config.gateway.version} but this Claudex release ships manifest ${manifest.version}. Update Claudex or reset gateway.version.`,
    });
    return false;
  }

  const selection = selectArtifact(manifest, options.platform, options.arch);
  if (!selection.ok) {
    steps.push({ name: "gateway-install", status: "failed", detail: selection.error });
    return false;
  }
  const installedBinary = join(
    options.paths.dataDir,
    "gateway",
    "versions",
    manifest.version,
    selection.artifact.binaryName,
  );
  const alreadyInstalled = await access(installedBinary).then(
    () => true,
    () => false,
  );
  if (alreadyInstalled) {
    steps.push({
      name: "gateway-install",
      status: "skipped",
      detail: `Gateway ${manifest.version} is already installed.`,
    });
    return true;
  }

  const installed = await installGatewayVersion({
    paths: options.paths,
    manifest,
    platform: options.platform,
    arch: options.arch,
    ...(options.downloader !== undefined ? { downloader: options.downloader } : {}),
    ...(options.extractor !== undefined ? { extractor: options.extractor } : {}),
  });
  if (!installed.ok) {
    steps.push({ name: "gateway-install", status: "failed", detail: installed.error });
    return false;
  }
  steps.push({
    name: "gateway-install",
    status: "ok",
    detail: `Installed and checksum-verified gateway ${installed.version}.`,
  });
  return true;
}

/**
 * Guided, idempotent installation: config file, pinned gateway, persistent
 * gateway service (Linux), and the stable `claudex` shim. Every step reports
 * its outcome; a failed step stops the steps that depend on it.
 */
export async function runSetup(options: SetupOptions): Promise<SetupReport> {
  const steps: SetupStep[] = [];
  const manifest = options.manifest ?? GATEWAY_MANIFEST;
  const report = (ok: boolean): SetupReport => ({ ok, steps, relaunchRequired: ok });

  const config = await ensureConfig(options.paths, steps);
  if (config === undefined) {
    return report(false);
  }

  if (!(await ensureGatewayInstalled(options, config, manifest, steps))) {
    return report(false);
  }

  const selection = selectArtifact(manifest, options.platform, options.arch);
  if (!selection.ok) {
    steps.push({ name: "gateway-activate", status: "failed", detail: selection.error });
    return report(false);
  }
  const activation = await activateGatewayVersion(
    options.paths,
    manifest.version,
    selection.artifact.binaryName,
  );
  if (!activation.ok) {
    steps.push({ name: "gateway-activate", status: "failed", detail: activation.error });
    return report(false);
  }
  steps.push({
    name: "gateway-activate",
    status: "ok",
    detail: `Active gateway is ${activation.active.version}.`,
  });

  const clientSecret = await ensurePersistentSecret(options.paths);
  const gatewayConfigFile = await writePersistentConfig(options.paths, config, clientSecret);
  steps.push({
    name: "gateway-config",
    status: "ok",
    detail: `Wrote owner-only gateway configuration to ${gatewayConfigFile}.`,
  });

  let serviceHealthy = false;
  if (config.runtime.mode !== "persistent") {
    steps.push({
      name: "service",
      status: "skipped",
      detail: "Session mode is configured; the gateway starts per launch.",
    });
  } else {
    const runner = options.runner ?? createSystemctlRunner();
    const serviceMode = await resolveServiceMode(options.platform, runner);
    if (serviceMode !== "systemd") {
      steps.push({
        name: "service",
        status: "skipped",
        detail:
          "User systemd is unavailable on this host; launches fall back to session mode gateways.",
      });
    } else {
      const install = await installService({
        unitDir: options.unitDir,
        binaryFile: activation.active.binaryFile,
        configFile: gatewayConfigFile,
        runner,
        localModelCatalog: !config.advanced.remoteModelCatalog,
      });
      if (!install.ok) {
        steps.push({ name: "service", status: "failed", detail: install.error });
        return report(false);
      }
      const start = await startService(runner);
      if (!start.ok) {
        steps.push({ name: "service", status: "failed", detail: start.error });
        return report(false);
      }
      steps.push({
        name: "service",
        status: "ok",
        detail: "Installed and started the claudex-gateway user service.",
      });

      const probe = options.probe ?? defaultHealthProbe;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !serviceHealthy) {
        serviceHealthy = await probe({
          host: config.runtime.host,
          port: config.runtime.port,
          clientSecret,
        });
        if (!serviceHealthy) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      steps.push(
        serviceHealthy
          ? { name: "health", status: "ok", detail: "The gateway answered an authenticated probe." }
          : {
              name: "health",
              status: "failed",
              detail: "The gateway service did not answer its authenticated probe. Run doctor.",
            },
      );
      if (!serviceHealthy) {
        return report(false);
      }
    }
  }

  const shim = await installShim({
    binDir: options.binDir,
    platform: options.platform,
    managerEntry: options.managerEntry,
  });
  if (!shim.ok) {
    steps.push({ name: "launcher-shim", status: "failed", detail: shim.error });
    return report(false);
  }
  steps.push({
    name: "launcher-shim",
    status: "ok",
    detail: `Installed ${join(options.binDir, shimFileName(options.platform))}.`,
  });

  return report(true);
}

export function renderSetupReport(report: SetupReport): string {
  const lines = report.steps.map(
    (step) => `[${step.status.padEnd(7)}] ${step.name}: ${step.detail}`,
  );
  lines.push("");
  if (report.ok) {
    lines.push(
      "Setup complete. Next: run `claudex-pluginctl login` in an interactive terminal, then start Claude Code through the `claudex` launcher.",
      "An already-running Claude Code session keeps its current provider; only a new `claudex` launch uses the gateway.",
    );
  } else {
    lines.push("Setup did not complete. Fix the failed step above and run setup again.");
  }
  lines.push("");
  return lines.join("\n");
}
