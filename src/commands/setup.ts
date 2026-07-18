import { access } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import type { ClaudexConfig } from "../config/defaults.js";
import { REASONING_EFFORT_VALUES, RUNTIME_MODE_VALUES } from "../config/schema.js";
import { loadConfig, saveConfig } from "../config/store.js";
import { activateGatewayVersion } from "../gateway/activate.js";
import { type Downloader, type Extractor, installGatewayVersion } from "../gateway/install.js";
import { GATEWAY_MANIFEST, type GatewayManifest, selectArtifact } from "../gateway/manifest.js";
import { checkGlobalClaudeConflicts, ensurePersistentSecret } from "../launcher/launch.js";
import { inspectShim, installShim, shimFileName } from "../launcher/shim.js";
import { defaultHealthProbe, writePersistentConfig } from "../lifecycle/cliproxy.js";
import type { LaunchctlRunner } from "../lifecycle/launchd.js";
import { resolvePersistentService } from "../lifecycle/service.js";
import type { HealthProbe } from "../lifecycle/session.js";
import type { SystemctlRunner } from "../lifecycle/systemd.js";
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

interface SetupPlanOption {
  readonly label: string;
  readonly value: string;
  readonly description: string;
}

export interface SetupPlan {
  readonly version: 1;
  readonly current: {
    readonly runtimeMode: ClaudexConfig["runtime"]["mode"];
    readonly models: ClaudexConfig["models"];
    readonly reasoningEffort: ClaudexConfig["reasoning"]["effort"];
  };
  readonly profile: {
    readonly header: "Setup profile";
    readonly question: string;
    readonly options: readonly SetupPlanOption[];
    readonly recommendedChanges: readonly [
      { readonly key: "runtime.mode"; readonly value: "persistent" },
    ];
  };
  readonly customization: readonly [
    {
      readonly id: "runtime";
      readonly key: "runtime.mode";
      readonly header: "Runtime";
      readonly question: string;
      readonly values: typeof RUNTIME_MODE_VALUES;
      readonly options: readonly SetupPlanOption[];
    },
    {
      readonly id: "models";
      readonly keys: readonly ["models.main", "models.subagent", "models.fallback"];
      readonly header: "Models";
      readonly question: string;
      readonly inputFormat: string;
      readonly options: readonly SetupPlanOption[];
    },
    {
      readonly id: "reasoning";
      readonly key: "reasoning.effort";
      readonly scope: "global";
      readonly appliesTo: readonly ["main", "subagent", "fallback"];
      readonly header: "Reasoning";
      readonly question: string;
      readonly values: typeof REASONING_EFFORT_VALUES;
      readonly options: readonly SetupPlanOption[];
      readonly otherValues: readonly ["xhigh", "max"];
    },
  ];
}

export type SetupPreflightStatus = "pass" | "warn" | "fail" | "skip";

export interface SetupPreflightCheck {
  readonly name: "config" | "platform" | "launcher" | "launcher-path" | "claude-settings";
  readonly status: SetupPreflightStatus;
  readonly detail: string;
  readonly remediation?: string | undefined;
}

export interface SetupPreflightReport {
  readonly ok: boolean;
  readonly checks: readonly SetupPreflightCheck[];
}

export interface SetupPreflightOptions {
  readonly paths: ClaudexPaths;
  readonly platform: string;
  readonly arch: string;
  readonly binDir: string;
  readonly manifest?: GatewayManifest;
  readonly pathValue?: string | undefined;
  readonly claudeSettingsFile?: string | undefined;
}

/** Machine-readable setup contract consumed by the plugin skill. */
export function buildSetupPlan(config: ClaudexConfig): SetupPlan {
  return {
    version: 1,
    current: {
      runtimeMode: config.runtime.mode,
      models: config.models,
      reasoningEffort: config.reasoning.effort,
    },
    profile: {
      header: "Setup profile",
      question: "Select a setup profile.",
      options: [
        {
          label: "Recommended configuration",
          value: "recommended",
          description:
            "Use a persistent gateway and retain the current model IDs and global reasoning effort.",
        },
        {
          label: "Customize",
          value: "customize",
          description: "Review the supported runtime, model, and global reasoning settings.",
        },
      ],
      recommendedChanges: [{ key: "runtime.mode", value: "persistent" }],
    },
    customization: [
      {
        id: "runtime",
        key: "runtime.mode",
        header: "Runtime",
        question: "Select the gateway runtime.",
        values: RUNTIME_MODE_VALUES,
        options: [
          {
            label: "Persistent (Recommended)",
            value: "persistent",
            description: "Run one managed background gateway for fast session startup.",
          },
          {
            label: "Session",
            value: "session",
            description: "Start and stop an isolated gateway with each Claude Code session.",
          },
        ],
      },
      {
        id: "models",
        keys: ["models.main", "models.subagent", "models.fallback"],
        header: "Models",
        question: "Retain the current model IDs or provide all three role assignments?",
        inputFormat: "main=<id>, subagent=<id>, fallback=<id>",
        options: [
          {
            label: "Retain current models (Recommended)",
            value: "current",
            description: "Keep the displayed main, subagent, and fallback model IDs.",
          },
          {
            label: "Custom model IDs",
            value: "custom",
            description:
              "Provide exact IDs for main, subagent, and fallback; no role may be omitted.",
          },
        ],
      },
      {
        id: "reasoning",
        key: "reasoning.effort",
        scope: "global",
        appliesTo: ["main", "subagent", "fallback"],
        header: "Reasoning",
        question: "Select one global reasoning effort for all models.",
        values: REASONING_EFFORT_VALUES,
        options: [
          {
            label: "Keep current (Recommended)",
            value: "current",
            description: "Retain the displayed global reasoning effort.",
          },
          { label: "Low", value: "low", description: "Use low reasoning effort globally." },
          {
            label: "Medium",
            value: "medium",
            description: "Use medium reasoning effort globally.",
          },
          { label: "High", value: "high", description: "Use high reasoning effort globally." },
        ],
        otherValues: ["xhigh", "max"],
      },
    ],
  };
}

function pathContains(binDir: string, pathValue: string, platform: string): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const separator = platform === "win32" ? ";" : ":";
  const expected = pathApi.resolve(binDir);
  return pathValue
    .split(separator)
    .filter((entry) => entry !== "")
    .some((entry) => {
      const resolved = pathApi.resolve(entry);
      return platform === "win32"
        ? resolved.toLowerCase() === expected.toLowerCase()
        : resolved === expected;
    });
}

export async function runSetupPreflight(
  options: SetupPreflightOptions,
): Promise<SetupPreflightReport> {
  const checks: SetupPreflightCheck[] = [];
  const config = await loadConfig(options.paths);
  checks.push(
    config.ok
      ? { name: "config", status: "pass", detail: `Valid configuration (${config.source}).` }
      : {
          name: "config",
          status: "fail",
          detail: config.error,
          remediation: "Fix the reported configuration error or run `config reset`.",
        },
  );

  const artifact = selectArtifact(
    options.manifest ?? GATEWAY_MANIFEST,
    options.platform,
    options.arch,
  );
  checks.push(
    artifact.ok
      ? { name: "platform", status: "pass", detail: `${options.platform}/${options.arch}` }
      : {
          name: "platform",
          status: "fail",
          detail: artifact.error,
          remediation: "Use a supported Claudex platform and architecture.",
        },
  );

  const launcher = await inspectShim({ binDir: options.binDir, platform: options.platform });
  checks.push(
    launcher.status === "foreign"
      ? {
          name: "launcher",
          status: "fail",
          detail: `${launcher.file} exists but is not managed by Claudex.`,
          remediation: "Back up or rename the existing launcher, then run preflight again.",
        }
      : {
          name: "launcher",
          status: "pass",
          detail:
            launcher.status === "managed"
              ? "Existing Claudex-managed launcher can be updated."
              : "Launcher destination is available.",
        },
  );

  checks.push(
    options.pathValue === undefined
      ? { name: "launcher-path", status: "skip", detail: "PATH was not provided." }
      : pathContains(options.binDir, options.pathValue, options.platform)
        ? { name: "launcher-path", status: "pass", detail: "Launcher directory is on PATH." }
        : {
            name: "launcher-path",
            status: "warn",
            detail: "Launcher directory is not on PATH.",
            remediation: `Add ${options.binDir} to PATH before launching Claudex.`,
          },
  );

  if (options.claudeSettingsFile === undefined) {
    checks.push({
      name: "claude-settings",
      status: "skip",
      detail: "Claude settings path was not provided.",
    });
  } else {
    const conflicts = await checkGlobalClaudeConflicts(options.claudeSettingsFile);
    checks.push(
      conflicts.length === 0
        ? { name: "claude-settings", status: "pass", detail: "No routing conflicts found." }
        : {
            name: "claude-settings",
            status: "warn",
            detail: conflicts.join(" "),
            remediation:
              "Remove the reported global override or confirm that it should shadow Claudex session settings.",
          },
    );
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
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
  /** LaunchAgent directory; only used on macOS persistent mode. */
  readonly agentDir?: string;
  readonly launchctl?: LaunchctlRunner;
  readonly uid?: number;
  readonly manifest?: GatewayManifest;
  readonly downloader?: Downloader;
  readonly extractor?: Extractor;
  readonly runner?: SystemctlRunner;
  readonly probe?: HealthProbe;
  readonly pathValue?: string | undefined;
  readonly claudeSettingsFile?: string | undefined;
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

  const preflight = await runSetupPreflight({
    paths: options.paths,
    platform: options.platform,
    arch: options.arch,
    binDir: options.binDir,
    manifest,
    pathValue: options.pathValue,
    claudeSettingsFile: options.claudeSettingsFile,
  });
  const blockers = preflight.checks.filter((check) => check.status === "fail");
  if (blockers.length > 0) {
    steps.push({
      name: "preflight",
      status: "failed",
      detail: blockers
        .map((check) => `${check.detail} ${check.remediation ?? ""}`.trim())
        .join(" "),
    });
    return report(false);
  }
  const warnings = preflight.checks.filter((check) => check.status === "warn");
  steps.push({
    name: "preflight",
    status: "ok",
    detail:
      warnings.length === 0
        ? "Configuration, platform, launcher, PATH, and Claude settings checks passed."
        : `Passed with ${warnings.length} warning(s): ${warnings.map((check) => check.detail).join(" ")}`,
  });

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

  if (config.runtime.mode !== "persistent") {
    steps.push({
      name: "service",
      status: "skipped",
      detail: "Session mode is configured; the gateway starts per launch.",
    });
  } else {
    const service = await resolvePersistentService({
      platform: options.platform,
      unitDir: options.unitDir,
      systemctl: options.runner,
      agentDir: options.agentDir,
      launchctl: options.launchctl,
      uid: options.uid,
    });
    if (service === undefined) {
      steps.push({
        name: "service",
        status: "skipped",
        detail:
          "No per-user service manager is available on this host; launches fall back to session mode gateways.",
      });
    } else {
      const install = await service.install({
        binaryFile: activation.active.binaryFile,
        configFile: gatewayConfigFile,
        localModelCatalog: !config.advanced.remoteModelCatalog,
      });
      if (!install.ok) {
        steps.push({ name: "service", status: "failed", detail: install.error });
        return report(false);
      }
      const start = await service.start();
      if (!start.ok) {
        steps.push({ name: "service", status: "failed", detail: start.error });
        return report(false);
      }
      steps.push({
        name: "service",
        status: "ok",
        detail: `Installed and started the persistent gateway (${service.kind}).`,
      });

      const probe = options.probe ?? defaultHealthProbe;
      const deadline = Date.now() + 15_000;
      let serviceHealthy = false;
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
      "Installation complete. Next: run `/claudex:login`; Claudex opens the browser sign-in and verifies the result in this session.",
      "An already-running Claude Code session keeps its current provider; only a new `claudex` launch uses the gateway.",
    );
  } else {
    lines.push("Setup did not complete. Fix the failed step above and run setup again.");
  }
  lines.push("");
  return lines.join("\n");
}
