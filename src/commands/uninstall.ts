import { rm } from "node:fs/promises";
import { join } from "node:path";
import { removeShim } from "../launcher/shim.js";
import type { LaunchctlRunner } from "../lifecycle/launchd.js";
import { createLaunchctlRunner, removeLaunchAgent } from "../lifecycle/launchd.js";
import {
  createSystemctlRunner,
  removeService,
  type SystemctlRunner,
} from "../lifecycle/systemd.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface UninstallStep {
  readonly name: string;
  readonly status: "ok" | "skipped" | "failed";
  readonly detail: string;
}

export interface UninstallReport {
  readonly ok: boolean;
  readonly steps: readonly UninstallStep[];
}

export interface UninstallOptions {
  readonly paths: ClaudexPaths;
  readonly platform: string;
  readonly binDir: string;
  readonly unitDir: string;
  /**
   * Credential removal is a separate, explicit decision (ADR 0004); there is
   * deliberately no default.
   */
  readonly removeCredentials: boolean;
  /** Also remove the validated configuration and its backup. */
  readonly removeConfig?: boolean;
  readonly runner?: SystemctlRunner;
  /** LaunchAgent directory; only used on macOS. */
  readonly agentDir?: string;
  readonly launchctl?: LaunchctlRunner;
  readonly uid?: number;
}

/**
 * Removes what Claudex installed — service, shim, gateway versions, runtime
 * state — and nothing else. Foreign launchers, units, and gateway
 * installations are refused by the managed-marker checks, not deleted.
 */
export async function runUninstall(options: UninstallOptions): Promise<UninstallReport> {
  const steps: UninstallStep[] = [];
  let ok = true;
  const record = (name: string, status: UninstallStep["status"], detail: string): void => {
    steps.push({ name, status, detail });
    if (status === "failed") {
      ok = false;
    }
  };

  if (options.platform === "linux") {
    const runner = options.runner ?? createSystemctlRunner();
    const service = await removeService({ unitDir: options.unitDir, runner });
    record(
      "service",
      service.ok ? "ok" : "failed",
      service.ok ? "Gateway service stopped and removed (if it was installed)." : service.error,
    );
  } else if (options.platform === "darwin" && options.agentDir !== undefined) {
    const agent = await removeLaunchAgent({
      agentDir: options.agentDir,
      runner: options.launchctl ?? createLaunchctlRunner(),
      uid: options.uid ?? process.getuid?.() ?? 0,
    });
    record(
      "service",
      agent.ok ? "ok" : "failed",
      agent.ok ? "Gateway launch agent stopped and removed (if it was installed)." : agent.error,
    );
  } else {
    record("service", "skipped", "No service manager integration on this platform yet.");
  }

  const shim = await removeShim({ binDir: options.binDir, platform: options.platform });
  record(
    "launcher-shim",
    shim.ok ? "ok" : "failed",
    shim.ok ? "Removed the claudex launcher (if it was installed)." : shim.error,
  );

  // Runtime state this manager wrote; credentials live one level deeper and
  // are only touched with the explicit flag below.
  for (const relative of [
    "sessions",
    "gateway-persistent.yaml",
    "persistent-secret",
    "login.lock",
  ]) {
    await rm(join(options.paths.stateDir, relative), { recursive: true, force: true });
  }
  record("state", "ok", "Removed session bookkeeping, gateway config, and the client secret.");

  await rm(join(options.paths.dataDir, "gateway"), { recursive: true, force: true });
  record("gateway", "ok", "Removed installed gateway versions and the activation pointer.");

  if (options.removeCredentials) {
    await rm(options.paths.credentialsDir, { recursive: true, force: true });
    record("credentials", "ok", "Removed stored Codex credentials.");
  } else {
    record(
      "credentials",
      "skipped",
      `Kept credentials in ${options.paths.credentialsDir} (remove later with --delete-credentials).`,
    );
  }

  if (options.removeConfig === true) {
    await rm(options.paths.configFile, { force: true });
    await rm(options.paths.configBackupFile, { force: true });
    record("config", "ok", "Removed the Claudex configuration and its backup.");
  } else {
    record("config", "skipped", `Kept ${options.paths.configFile} for a future reinstall.`);
  }

  return { ok, steps };
}

export function renderUninstallReport(report: UninstallReport): string {
  const lines = report.steps.map(
    (step) => `[${step.status.padEnd(7)}] ${step.name}: ${step.detail}`,
  );
  lines.push("");
  lines.push(
    report.ok
      ? "Uninstall complete. Normal `claude` sessions were never modified and continue to work."
      : "Uninstall finished with failures; nothing unrelated to Claudex was touched.",
  );
  lines.push("");
  return lines.join("\n");
}
