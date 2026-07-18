import { stat } from "node:fs/promises";
import { inspectCredentialMetadata } from "../auth/metadata.js";
import { loadConfig } from "../config/store.js";
import { getActiveGateway } from "../gateway/activate.js";
import { GATEWAY_MANIFEST, selectArtifact } from "../gateway/manifest.js";
import { checkGlobalClaudeConflicts } from "../launcher/launch.js";
import type { ClaudexPaths } from "../platform/paths.js";
import { VERSION } from "../version.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Present exactly when the check did not pass cleanly. */
  readonly remediation?: string | undefined;
}

export interface DoctorReport {
  readonly claudexVersion: string;
  readonly overall: "pass" | "warn" | "fail";
  readonly checks: readonly DoctorCheck[];
}

/** HTTP access used by live checks; injectable so tests stay offline. */
export type DoctorFetch = (
  url: string,
  init: {
    readonly method?: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{ readonly status: number; readonly bodyText: () => Promise<string> }>;

export interface DoctorOptions {
  readonly paths: ClaudexPaths;
  readonly platform?: string | undefined;
  readonly arch?: string | undefined;
  readonly nodeVersion?: string | undefined;
  /** Skip all checks that need a reachable gateway. */
  readonly offline?: boolean | undefined;
  /** Explicit consent for one bounded live inference request. */
  readonly allowLiveInference?: boolean | undefined;
  readonly fetchFn?: DoctorFetch | undefined;
  readonly claudeSettingsFile?: string | undefined;
  /** Client secret for authenticated gateway checks (persistent mode). */
  readonly clientSecret?: string | undefined;
}

const defaultFetch: DoctorFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body ?? null,
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, bodyText: () => response.text() };
};

function ownerOnly(mode: number): boolean {
  return (mode & 0o077) === 0;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const nodeVersion = options.nodeVersion ?? process.version;
  const fetchFn = options.fetchFn ?? defaultFetch;
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck): void => {
    checks.push(check);
  };

  const nodeParts = nodeVersion.replace(/^v/, "").split(".").map(Number);
  const nodeOk =
    (nodeParts[0] ?? 0) > 22 || ((nodeParts[0] ?? 0) === 22 && (nodeParts[1] ?? 0) >= 19);
  add({
    name: "node-version",
    status: nodeOk ? "pass" : "fail",
    detail: `Node ${nodeVersion}`,
    remediation: nodeOk ? undefined : "Install Node.js 22.19 or newer.",
  });

  const artifact = selectArtifact(GATEWAY_MANIFEST, platform, arch);
  add({
    name: "platform-supported",
    status: artifact.ok ? "pass" : "fail",
    detail: `${platform}/${arch}`,
    remediation: artifact.ok ? undefined : artifact.error,
  });

  const config = await loadConfig(options.paths);
  add({
    name: "config-valid",
    status: config.ok ? "pass" : "fail",
    detail: config.ok ? `source: ${config.source}` : config.error,
    remediation: config.ok ? undefined : "Fix the reported fields or run `config reset`.",
  });

  if (platform === "win32") {
    add({ name: "state-permissions", status: "skip", detail: "not applicable on Windows" });
  } else {
    const problems: string[] = [];
    for (const dir of [
      options.paths.configDir,
      options.paths.stateDir,
      options.paths.credentialsDir,
    ]) {
      const info = await stat(dir).catch(() => undefined);
      if (info !== undefined && !ownerOnly(info.mode)) {
        problems.push(dir);
      }
    }
    add({
      name: "state-permissions",
      status: problems.length === 0 ? "pass" : "fail",
      detail:
        problems.length === 0 ? "owner-only" : `group/world-accessible: ${problems.join(", ")}`,
      remediation: problems.length === 0 ? undefined : "Run `chmod 700` on the listed directories.",
    });
  }

  const active = await getActiveGateway(options.paths);
  if (active === undefined) {
    add({
      name: "gateway-installed",
      status: "fail",
      detail: "no active gateway version",
      remediation: "Run setup to install and activate the pinned gateway.",
    });
  } else {
    const pinned = active.version === GATEWAY_MANIFEST.version;
    const binary = await stat(active.binaryFile).catch(() => undefined);
    add({
      name: "gateway-installed",
      status: binary === undefined ? "fail" : pinned ? "pass" : "warn",
      detail:
        binary === undefined
          ? `active version ${active.version} is missing its binary`
          : `version ${active.version}${pinned ? "" : ` (pinned: ${GATEWAY_MANIFEST.version})`}`,
      remediation:
        binary === undefined
          ? "Reinstall the gateway via setup."
          : pinned
            ? undefined
            : "Run update to move to the pinned version.",
    });
  }

  add({
    name: "bind-address",
    status: config.ok ? "pass" : "skip",
    detail: config.ok
      ? `${config.config.runtime.host}:${config.config.runtime.port} (loopback enforced by validation)`
      : "config unavailable",
  });

  const credentials = await inspectCredentialMetadata(options.paths.credentialsDir);
  add({
    name: "credentials",
    status: credentials.present ? (credentials.ownerOnly ? "pass" : "fail") : "fail",
    detail: credentials.present
      ? `present, owner-only: ${credentials.ownerOnly}${credentials.expiresAt === undefined ? "" : `, expires ${credentials.expiresAt}`}`
      : "no credential metadata",
    remediation: credentials.present
      ? credentials.ownerOnly
        ? undefined
        : "Restrict the credential file to owner-only permissions and log in again."
      : "Run login to authenticate.",
  });

  const conflicts =
    options.claudeSettingsFile === undefined
      ? []
      : await checkGlobalClaudeConflicts(options.claudeSettingsFile);
  add({
    name: "claude-settings-conflicts",
    status: conflicts.length === 0 ? "pass" : "warn",
    detail: conflicts.length === 0 ? "no global model/base-URL overrides" : conflicts.join(" "),
    remediation:
      conflicts.length === 0
        ? undefined
        : "Remove the global overrides or expect them to shadow claudex sessions.",
  });

  const base = config.ok
    ? `http://${config.config.runtime.host}:${config.config.runtime.port}`
    : undefined;
  const authHeaders =
    options.clientSecret === undefined
      ? undefined
      : { authorization: `Bearer ${options.clientSecret}` };

  if (options.offline === true || !config.ok || base === undefined || authHeaders === undefined) {
    const detail = options.offline === true ? "offline mode" : "no gateway target or client secret";
    add({ name: "gateway-health", status: "skip", detail });
    add({ name: "model-inventory", status: "skip", detail });
    add({ name: "token-counting", status: "skip", detail });
  } else {
    let healthy = false;
    let models: string[] = [];
    try {
      const response = await fetchFn(`${base}/v1/models`, { headers: authHeaders });
      healthy = response.status === 200;
      if (healthy) {
        const parsed: unknown = JSON.parse(await response.bodyText());
        const data =
          typeof parsed === "object" && parsed !== null
            ? (parsed as { data?: ReadonlyArray<{ id?: string }> }).data
            : undefined;
        models = (data ?? []).map((entry) => entry.id ?? "").filter((id) => id !== "");
      }
    } catch {
      healthy = false;
    }
    add({
      name: "gateway-health",
      status: healthy ? "pass" : "fail",
      detail: healthy
        ? `authenticated response from ${base}`
        : `no authenticated response from ${base}`,
      remediation: healthy
        ? undefined
        : "Start the gateway (service or session) and re-run doctor.",
    });

    const mainModel = config.config.models.main;
    const listed = models.includes(mainModel);
    add({
      name: "model-inventory",
      status: healthy ? (listed ? "pass" : "warn") : "skip",
      detail: healthy
        ? listed
          ? `configured main model available (${models.length} models)`
          : `configured main model not in inventory (${models.length} models)`
        : "gateway unreachable",
      remediation:
        healthy && !listed
          ? "Check login entitlements or configure an available model."
          : undefined,
    });

    let counting: CheckStatus = "skip";
    if (healthy) {
      try {
        const response = await fetchFn(`${base}/v1/messages/count_tokens`, {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            model: mainModel,
            messages: [{ role: "user", content: "ping" }],
          }),
        });
        counting = response.status === 200 ? "pass" : "warn";
      } catch {
        counting = "warn";
      }
    }
    add({
      name: "token-counting",
      status: counting,
      detail:
        counting === "pass"
          ? "count_tokens answered"
          : counting === "warn"
            ? "count_tokens unavailable"
            : "gateway unreachable",
      remediation:
        counting === "warn"
          ? "Token counting may be degraded; context tracking can drift."
          : undefined,
    });
  }

  if (options.allowLiveInference !== true) {
    add({
      name: "live-inference",
      status: "skip",
      detail: "requires explicit consent (--allow-live-inference)",
    });
  } else if (base === undefined || authHeaders === undefined || options.offline === true) {
    add({ name: "live-inference", status: "skip", detail: "gateway unavailable" });
  } else {
    let status: CheckStatus = "fail";
    let detail = "bounded live request failed";
    let remediation = "Check gateway connectivity and retry the compatibility check.";
    try {
      // Bounded on purpose: one request, minimal output budget.
      const response = await fetchFn(`${base}/v1/messages`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          model: config.ok ? config.config.models.main : "",
          max_tokens: 8,
          messages: [{ role: "user", content: "Reply with OK." }],
        }),
      });
      status = response.status === 200 ? "pass" : "fail";
      if (status === "pass") {
        detail = "bounded live request succeeded";
        remediation = "";
      } else {
        detail = `bounded live request returned HTTP ${response.status}`;
        remediation =
          response.status === 400
            ? "The pinned gateway request contract is incompatible with the upstream API. Update Claudex or report a compatibility failure; re-authentication will not fix it."
            : response.status === 401 || response.status === 403
              ? "Refresh authentication and confirm that the account has Codex access."
              : response.status >= 500
                ? "The gateway or upstream service failed; retry, then run update if the failure persists."
                : "Run doctor again and report the HTTP status if the failure persists.";
      }
    } catch {
      status = "fail";
    }
    add({
      name: "live-inference",
      status,
      detail,
      remediation: status === "pass" ? undefined : remediation,
    });
  }

  const overall = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";
  return { claudexVersion: VERSION, overall, checks };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`Claudex ${report.claudexVersion} doctor: ${report.overall}`];
  for (const check of report.checks) {
    lines.push(`  [${check.status.padEnd(4)}] ${check.name}: ${check.detail}`);
    if (check.remediation !== undefined) {
      lines.push(`         -> ${check.remediation}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
