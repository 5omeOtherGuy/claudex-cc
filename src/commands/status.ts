import type { CredentialMetadata } from "../auth/metadata.js";
import { inspectCredentialMetadata } from "../auth/metadata.js";
import { loadConfig } from "../config/store.js";
import { getActiveGateway } from "../gateway/activate.js";
import { GATEWAY_MANIFEST } from "../gateway/manifest.js";
import { prepareLaunch } from "../launcher/launch.js";
import type { HealthProbe } from "../lifecycle/session.js";
import type { ClaudexPaths } from "../platform/paths.js";
import { VERSION } from "../version.js";

export interface StatusReport {
  readonly claudexVersion: string;
  readonly configSource: "file" | "defaults" | "invalid";
  readonly gateway: {
    readonly activeVersion?: string | undefined;
    readonly pinnedVersion: string;
  };
  readonly auth: CredentialMetadata;
  readonly models?:
    | { readonly main: string; readonly subagent: string; readonly fallback: string }
    | undefined;
  readonly launch: {
    readonly ready: boolean;
    readonly blocker?: string | undefined;
  };
}

export interface StatusOptions {
  readonly paths: ClaudexPaths;
  /** Health probe for launch readiness; defaults to "not probed" (offline). */
  readonly probe?: HealthProbe;
}

export async function collectStatus(options: StatusOptions): Promise<StatusReport> {
  const config = await loadConfig(options.paths);
  const active = await getActiveGateway(options.paths);
  const auth = await inspectCredentialMetadata(options.paths.credentialsDir);

  let launch: StatusReport["launch"] = { ready: false, blocker: "not probed (offline status)" };
  if (config.ok && options.probe !== undefined) {
    const prepared = await prepareLaunch({
      paths: options.paths,
      config: config.config,
      probe: options.probe,
    });
    launch = prepared.ok
      ? { ready: true }
      : { ready: false, blocker: `${prepared.reason}: ${prepared.remediation}` };
  }

  return {
    claudexVersion: VERSION,
    configSource: config.ok ? config.source : "invalid",
    gateway: { activeVersion: active?.version, pinnedVersion: GATEWAY_MANIFEST.version },
    auth,
    models: config.ok ? config.config.models : undefined,
    launch,
  };
}

export function renderStatusReport(report: StatusReport): string {
  const lines = [
    `Claudex ${report.claudexVersion}`,
    `  config: ${report.configSource}`,
    `  gateway: ${report.gateway.activeVersion ?? "not installed"} (pinned: ${report.gateway.pinnedVersion})`,
    `  auth: ${report.auth.present ? `credentials present (owner-only: ${report.auth.ownerOnly})` : "not logged in"}`,
  ];
  if (report.models !== undefined) {
    lines.push(`  models: ${report.models.main} / ${report.models.subagent}`);
  }
  lines.push(
    `  launch: ${report.launch.ready ? "ready" : `blocked${report.launch.blocker === undefined ? "" : ` (${report.launch.blocker})`}`}`,
  );
  return `${lines.join("\n")}\n`;
}
