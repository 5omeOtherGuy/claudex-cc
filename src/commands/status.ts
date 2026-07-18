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
  /** How the process that invoked this status was launched. */
  readonly session: {
    readonly throughGateway: boolean;
    readonly detail: string;
  };
  /** Configuration drift that a relaunch, setup, or update would resolve. */
  readonly drift: readonly string[];
}

export interface StatusOptions {
  readonly paths: ClaudexPaths;
  /** Health probe for launch readiness; defaults to "not probed" (offline). */
  readonly probe?: HealthProbe;
  /** Environment of the invoking session; defaults to this process's env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Detects whether the invoking session was started through the claudex
 * launcher: its environment then carries a loopback gateway base URL. Only
 * the URL's shape is inspected; the value is never echoed.
 */
function detectSession(env: Readonly<Record<string, string | undefined>>): StatusReport["session"] {
  const baseUrl = env.ANTHROPIC_BASE_URL;
  if (baseUrl === undefined || baseUrl === "") {
    return {
      throughGateway: false,
      detail:
        "This session does not use the Claudex gateway. Start a new session with `claudex` to route through it; a running session cannot switch providers.",
    };
  }
  let loopback = false;
  try {
    const parsed = new URL(baseUrl);
    loopback = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|localhost)$/.test(parsed.hostname);
  } catch {
    // Malformed URLs are treated as non-gateway sessions.
  }
  return loopback
    ? { throughGateway: true, detail: "This session runs through a local loopback gateway." }
    : {
        throughGateway: false,
        detail:
          "This session uses a custom non-loopback base URL that Claudex does not manage. Start a new session with `claudex` to use the gateway.",
      };
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

  const drift: string[] = [];
  if (active !== undefined && active.version !== GATEWAY_MANIFEST.version) {
    drift.push(
      `Active gateway ${active.version} differs from the pinned release ${GATEWAY_MANIFEST.version}; run update.`,
    );
  }
  if (config.ok && config.config.gateway.version !== GATEWAY_MANIFEST.version) {
    drift.push(
      `Config pins gateway ${config.config.gateway.version} but this Claudex release ships ${GATEWAY_MANIFEST.version}; run update.`,
    );
  }
  if (config.ok && config.source === "defaults") {
    drift.push("No configuration file exists yet; run setup to persist the defaults.");
  }

  return {
    claudexVersion: VERSION,
    configSource: config.ok ? config.source : "invalid",
    gateway: { activeVersion: active?.version, pinnedVersion: GATEWAY_MANIFEST.version },
    auth,
    models: config.ok ? config.config.models : undefined,
    launch,
    session: detectSession(options.env ?? process.env),
    drift,
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
    `  session: ${report.session.detail}`,
  );
  for (const entry of report.drift) {
    lines.push(`  drift: ${entry}`);
  }
  return `${lines.join("\n")}\n`;
}
