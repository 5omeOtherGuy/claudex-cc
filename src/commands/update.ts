import type { ClaudexConfig } from "../config/defaults.js";
import { loadConfig, saveConfig } from "../config/store.js";
import {
  activateGatewayVersion,
  getActiveGateway,
  rollbackGatewayActivation,
} from "../gateway/activate.js";
import { type Downloader, type Extractor, installGatewayVersion } from "../gateway/install.js";
import { GATEWAY_MANIFEST, type GatewayManifest, selectArtifact } from "../gateway/manifest.js";
import { ensurePersistentSecret } from "../launcher/launch.js";
import { defaultHealthProbe, writePersistentConfig } from "../lifecycle/cliproxy.js";
import type { HealthProbe } from "../lifecycle/session.js";
import {
  createSystemctlRunner,
  installService,
  resolveServiceMode,
  restartService,
  type SystemctlRunner,
} from "../lifecycle/systemd.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface UpdatePlan {
  readonly currentVersion?: string | undefined;
  readonly targetVersion: string;
  readonly sha256: string;
  readonly assetName: string;
  readonly upToDate: boolean;
  /** What applying the update changes for compatibility, stated up front. */
  readonly impact: string;
}

export interface UpdateStep {
  readonly name: string;
  readonly status: "ok" | "skipped" | "failed" | "rolled-back";
  readonly detail: string;
}

export interface UpdateReport {
  readonly ok: boolean;
  readonly plan: UpdatePlan;
  readonly applied: boolean;
  readonly steps: readonly UpdateStep[];
}

export interface UpdateOptions {
  readonly paths: ClaudexPaths;
  readonly platform: string;
  readonly arch: string;
  /** systemd user-unit directory for persistent-mode service refresh. */
  readonly unitDir: string;
  /** false renders the plan without changing anything. */
  readonly apply: boolean;
  readonly manifest?: GatewayManifest;
  readonly downloader?: Downloader;
  readonly extractor?: Extractor;
  readonly runner?: SystemctlRunner;
  readonly probe?: HealthProbe;
  /** Bound for the post-restart health wait; tests shorten it. */
  readonly healthTimeoutMs?: number;
}

function buildPlan(
  manifest: GatewayManifest,
  platform: string,
  arch: string,
  currentVersion: string | undefined,
): UpdatePlan | { readonly error: string } {
  const selection = selectArtifact(manifest, platform, arch);
  if (!selection.ok) {
    return { error: selection.error };
  }
  const upToDate = currentVersion === manifest.version;
  return {
    currentVersion,
    targetVersion: manifest.version,
    sha256: selection.artifact.sha256,
    assetName: selection.artifact.assetName,
    upToDate,
    impact: upToDate
      ? "No change: the active gateway already matches the pinned release."
      : `Replaces gateway ${currentVersion ?? "(none)"} with the pinned, compatibility-reviewed ${manifest.version}; the previous version stays installed for rollback. Configuration and credentials are unchanged.`,
  };
}

async function refreshPersistentService(
  options: UpdateOptions,
  config: ClaudexConfig,
  binaryFile: string,
  runner: SystemctlRunner,
  steps: UpdateStep[],
): Promise<boolean> {
  const clientSecret = await ensurePersistentSecret(options.paths);
  const configFile = await writePersistentConfig(options.paths, config, clientSecret);
  const install = await installService({
    unitDir: options.unitDir,
    binaryFile,
    configFile,
    runner,
    localModelCatalog: !config.advanced.remoteModelCatalog,
  });
  if (!install.ok) {
    steps.push({ name: "service", status: "failed", detail: install.error });
    return false;
  }
  const restart = await restartService(runner);
  if (!restart.ok) {
    steps.push({ name: "service", status: "failed", detail: restart.error });
    return false;
  }

  const probe = options.probe ?? defaultHealthProbe;
  const deadline = Date.now() + (options.healthTimeoutMs ?? 15_000);
  let healthy = await probe({
    host: config.runtime.host,
    port: config.runtime.port,
    clientSecret,
  });
  while (Date.now() < deadline && !healthy) {
    healthy = await probe({
      host: config.runtime.host,
      port: config.runtime.port,
      clientSecret,
    });
    if (!healthy) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!healthy) {
    steps.push({
      name: "service",
      status: "failed",
      detail: "The restarted gateway did not answer its authenticated probe.",
    });
    return false;
  }
  steps.push({ name: "service", status: "ok", detail: "Gateway service restarted and healthy." });
  return true;
}

/**
 * Staged gateway update: install the pinned release side by side, activate it
 * atomically, refresh the persistent service, and roll the activation back if
 * the updated gateway does not come up healthy.
 */
export async function runUpdateCommand(options: UpdateOptions): Promise<UpdateReport> {
  const manifest = options.manifest ?? GATEWAY_MANIFEST;
  const steps: UpdateStep[] = [];
  const active = await getActiveGateway(options.paths);

  const planned = buildPlan(manifest, options.platform, options.arch, active?.version);
  if ("error" in planned) {
    const plan: UpdatePlan = {
      currentVersion: active?.version,
      targetVersion: manifest.version,
      sha256: "",
      assetName: "",
      upToDate: false,
      impact: planned.error,
    };
    steps.push({ name: "plan", status: "failed", detail: planned.error });
    return { ok: false, plan, applied: false, steps };
  }
  const plan = planned;

  if (!options.apply || plan.upToDate) {
    return { ok: true, plan, applied: false, steps };
  }

  const loaded = await loadConfig(options.paths);
  if (!loaded.ok) {
    steps.push({ name: "config", status: "failed", detail: loaded.error });
    return { ok: false, plan, applied: false, steps };
  }
  const config = loaded.config;

  const installed = await installGatewayVersion({
    paths: options.paths,
    manifest,
    platform: options.platform,
    arch: options.arch,
    ...(options.downloader !== undefined ? { downloader: options.downloader } : {}),
    ...(options.extractor !== undefined ? { extractor: options.extractor } : {}),
  });
  if (!installed.ok) {
    steps.push({ name: "install", status: "failed", detail: installed.error });
    return { ok: false, plan, applied: false, steps };
  }
  steps.push({
    name: "install",
    status: "ok",
    detail: `Installed and checksum-verified gateway ${installed.version} alongside the current version.`,
  });

  const selection = selectArtifact(manifest, options.platform, options.arch);
  if (!selection.ok) {
    steps.push({ name: "activate", status: "failed", detail: selection.error });
    return { ok: false, plan, applied: false, steps };
  }
  const activation = await activateGatewayVersion(
    options.paths,
    manifest.version,
    selection.artifact.binaryName,
  );
  if (!activation.ok) {
    steps.push({ name: "activate", status: "failed", detail: activation.error });
    return { ok: false, plan, applied: false, steps };
  }
  steps.push({
    name: "activate",
    status: "ok",
    detail: `Activated gateway ${activation.active.version}.`,
  });

  if (config.runtime.mode === "persistent") {
    const runner = options.runner ?? createSystemctlRunner();
    if ((await resolveServiceMode(options.platform, runner)) === "systemd") {
      const healthy = await refreshPersistentService(
        options,
        config,
        activation.active.binaryFile,
        runner,
        steps,
      );
      if (!healthy) {
        // The previous version is still installed; put it back in charge.
        const rollback = await rollbackGatewayActivation(options.paths);
        if (rollback.ok) {
          const clientSecret = await ensurePersistentSecret(options.paths);
          const configFile = await writePersistentConfig(options.paths, config, clientSecret);
          await installService({
            unitDir: options.unitDir,
            binaryFile: rollback.active.binaryFile,
            configFile,
            runner,
            localModelCatalog: !config.advanced.remoteModelCatalog,
          });
          await restartService(runner);
          steps.push({
            name: "rollback",
            status: "rolled-back",
            detail: `Reactivated gateway ${rollback.active.version} after the failed update.`,
          });
        } else {
          steps.push({ name: "rollback", status: "failed", detail: rollback.error });
        }
        return { ok: false, plan, applied: false, steps };
      }
    } else {
      steps.push({
        name: "service",
        status: "skipped",
        detail: "User systemd is unavailable; session launches pick up the new version directly.",
      });
    }
  } else {
    steps.push({
      name: "service",
      status: "skipped",
      detail: "Session mode: the next `claudex` launch uses the updated gateway.",
    });
  }

  // Keep the config pin in step with the activated release.
  if (config.gateway.version !== manifest.version) {
    await saveConfig(options.paths, {
      ...config,
      gateway: { ...config.gateway, version: manifest.version },
    });
    steps.push({
      name: "config-pin",
      status: "ok",
      detail: `Updated gateway.version to ${manifest.version}.`,
    });
  }

  return { ok: true, plan, applied: true, steps };
}

export function renderUpdateReport(report: UpdateReport): string {
  const lines = [
    `Gateway update plan:`,
    `  current: ${report.plan.currentVersion ?? "not installed"}`,
    `  target:  ${report.plan.targetVersion} (${report.plan.assetName})`,
    `  sha256:  ${report.plan.sha256}`,
    `  impact:  ${report.plan.impact}`,
  ];
  if (report.steps.length > 0) {
    lines.push("");
    for (const step of report.steps) {
      lines.push(`[${step.status.padEnd(11)}] ${step.name}: ${step.detail}`);
    }
  }
  lines.push("");
  if (report.applied) {
    lines.push("Update applied. Running `claudex` sessions keep their current gateway process.");
  } else if (report.ok) {
    lines.push(
      report.plan.upToDate
        ? "Nothing to do."
        : "Dry run only. Re-run `claudex-pluginctl update` without --check to apply.",
    );
  } else if (report.steps.some((step) => step.status === "rolled-back")) {
    lines.push("Update failed; the previous gateway version was reactivated.");
  } else if (report.steps.some((step) => step.name === "rollback" && step.status === "failed")) {
    lines.push("Update failed and rollback did not complete. Run doctor before launching.");
  } else {
    lines.push("Update failed. The active gateway was not changed.");
  }
  lines.push("");
  return lines.join("\n");
}
