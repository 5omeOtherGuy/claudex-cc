import { loadConfig, saveConfig } from "../config/store.js";
import { rollbackGatewayActivation } from "../gateway/activate.js";
import { ensurePersistentSecret } from "../launcher/launch.js";
import { defaultHealthProbe, writePersistentConfig } from "../lifecycle/cliproxy.js";
import type { LaunchctlRunner } from "../lifecycle/launchd.js";
import { resolvePersistentService } from "../lifecycle/service.js";
import type { HealthProbe } from "../lifecycle/session.js";
import type { SystemctlRunner } from "../lifecycle/systemd.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface RollbackStep {
  readonly name: string;
  readonly status: "ok" | "skipped" | "failed";
  readonly detail: string;
}

export interface RollbackReport {
  readonly ok: boolean;
  readonly steps: readonly RollbackStep[];
}

export interface RollbackOptions {
  readonly paths: ClaudexPaths;
  readonly platform: string;
  readonly unitDir: string;
  readonly runner?: SystemctlRunner;
  /** LaunchAgent directory; only used on macOS persistent mode. */
  readonly agentDir?: string;
  readonly launchctl?: LaunchctlRunner;
  readonly uid?: number;
  readonly probe?: HealthProbe;
  readonly healthTimeoutMs?: number;
}

/**
 * One-command recovery to the previously active gateway version. Works after
 * partial update failures: the activation pointer is restored first, and every
 * later step reports its own outcome instead of undoing the rollback.
 */
export async function runRollbackCommand(options: RollbackOptions): Promise<RollbackReport> {
  const steps: RollbackStep[] = [];
  let ok = true;
  const record = (name: string, status: RollbackStep["status"], detail: string): void => {
    steps.push({ name, status, detail });
    if (status === "failed") {
      ok = false;
    }
  };

  const rollback = await rollbackGatewayActivation(options.paths);
  if (!rollback.ok) {
    record("activate", "failed", rollback.error);
    return { ok: false, steps };
  }
  record("activate", "ok", `Reactivated gateway ${rollback.active.version}.`);

  const loaded = await loadConfig(options.paths);
  if (!loaded.ok) {
    record("config-pin", "failed", loaded.error);
    return { ok, steps };
  }
  let config = loaded.config;
  if (config.gateway.version !== rollback.active.version) {
    config = {
      ...config,
      gateway: { ...config.gateway, version: rollback.active.version },
    };
    try {
      await saveConfig(options.paths, config);
      record("config-pin", "ok", `Re-pinned gateway.version to ${rollback.active.version}.`);
    } catch (error: unknown) {
      record("config-pin", "failed", error instanceof Error ? error.message : String(error));
    }
  } else {
    record("config-pin", "skipped", "The config already pins the rolled-back version.");
  }

  if (config.runtime.mode !== "persistent") {
    record(
      "service",
      "skipped",
      "Session mode: the next `claudex` launch uses the rolled-back gateway.",
    );
    return { ok, steps };
  }

  const service = await resolvePersistentService({
    platform: options.platform,
    unitDir: options.unitDir,
    systemctl: options.runner,
    agentDir: options.agentDir,
    launchctl: options.launchctl,
    uid: options.uid,
  });
  if (service === undefined) {
    record(
      "service",
      "skipped",
      "No per-user service manager is available; session launches pick up the rollback directly.",
    );
    return { ok, steps };
  }

  const clientSecret = await ensurePersistentSecret(options.paths);
  const configFile = await writePersistentConfig(options.paths, config, clientSecret);
  const install = await service.install({
    binaryFile: rollback.active.binaryFile,
    configFile,
    localModelCatalog: !config.advanced.remoteModelCatalog,
  });
  if (!install.ok) {
    record("service", "failed", install.error);
    return { ok, steps };
  }
  const restart = await service.restart();
  if (!restart.ok) {
    record("service", "failed", restart.error);
    return { ok, steps };
  }

  const probe = options.probe ?? defaultHealthProbe;
  const deadline = Date.now() + (options.healthTimeoutMs ?? 15_000);
  let healthy = await probe({
    host: config.runtime.host,
    port: config.runtime.port,
    clientSecret,
  });
  while (!healthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    healthy = await probe({
      host: config.runtime.host,
      port: config.runtime.port,
      clientSecret,
    });
  }
  record(
    "service",
    healthy ? "ok" : "failed",
    healthy
      ? "Gateway service restarted on the rolled-back version and is healthy."
      : "The rolled-back gateway service did not answer its authenticated probe. Run doctor.",
  );
  return { ok, steps };
}

export function renderRollbackReport(report: RollbackReport): string {
  const lines = report.steps.map(
    (step) => `[${step.status.padEnd(7)}] ${step.name}: ${step.detail}`,
  );
  lines.push("");
  lines.push(
    report.ok
      ? "Rollback complete. Running `claudex` sessions keep their current gateway process."
      : "Rollback finished with failures; see the failed steps above and run doctor.",
  );
  lines.push("");
  return lines.join("\n");
}
