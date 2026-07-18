import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudexConfig } from "../config/defaults.js";
import type { ClaudexPaths } from "../platform/paths.js";
import { assertEmbeddablePath, ensureOwnerOnlyDir } from "../security/permissions.js";
import type {
  GatewayLauncher,
  GatewayRequestPolicy,
  HealthProbe,
  LaunchRequest,
} from "./session.js";
import { policyFromConfig } from "./session.js";

const LOOPBACK_PATTERN = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|localhost)$/;

const EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

function assertBoundedInteger(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Refusing to render a gateway config: ${name} must be an integer in [${min}, ${max}].`,
    );
  }
}

/**
 * Renders the per-session CLIProxyAPI configuration. Key names follow the
 * upstream config.example.yaml of the pinned release. The gateway stays
 * loopback-only, management stays local, and telemetry stays off.
 */
export function renderSessionConfig(
  request: Pick<LaunchRequest, "host" | "port" | "clientSecret" | "paths"> & {
    readonly policy?: GatewayRequestPolicy | undefined;
  },
): string {
  // Hard guards: these invariants must not be disabled by any caller.
  if (!LOOPBACK_PATTERN.test(request.host)) {
    throw new Error(`Refusing to render a gateway config for non-loopback host "${request.host}".`);
  }
  if (request.clientSecret.length < 32) {
    throw new Error("Refusing to render a gateway config without a strong client secret.");
  }
  if (!/^[a-f0-9]+$/.test(request.clientSecret)) {
    throw new Error("Refusing to embed a non-hex client secret into the gateway config.");
  }
  // Single-quoted YAML below: backslashes are literal, so Windows paths work.
  assertEmbeddablePath(request.paths.credentialsDir, "the gateway configuration", {
    allowBackslash: true,
  });

  const lines = [
    `host: "${request.host}"`,
    `port: ${request.port}`,
    `auth-dir: '${request.paths.credentialsDir}'`,
    "api-keys:",
    `  - "${request.clientSecret}"`,
    "remote-management:",
    "  allow-remote: false",
    '  secret-key: ""',
    "  disable-control-panel: true",
    "debug: false",
    "logging-to-file: false",
    "usage-statistics-enabled: false",
  ];

  const policy = request.policy;
  if (policy !== undefined) {
    // The rendered values are re-validated here so no caller can smuggle
    // unbounded retries or malformed YAML through the policy object.
    assertBoundedInteger(policy.retries, 0, 10, "requests.retries");
    assertBoundedInteger(
      policy.streamingKeepaliveSeconds,
      0,
      3_600,
      "advanced.streamingKeepaliveSeconds",
    );
    assertBoundedInteger(
      policy.streamingBootstrapRetries,
      0,
      5,
      "advanced.streamingBootstrapRetries",
    );
    assertBoundedInteger(policy.maxOutputTokens, 1, 10_000_000, "context.maxOutputTokens");
    if (!EFFORT_VALUES.has(policy.reasoningEffort)) {
      throw new Error("Refusing to render a gateway config with an unknown reasoning effort.");
    }
    lines.push(
      // Bounded retries for transient upstream failures (403/408/5xx);
      // permanent failures are surfaced immediately by the gateway.
      `request-retry: ${policy.retries}`,
      "routing:",
      '  strategy: "round-robin"',
      `  session-affinity: ${policy.sessionAffinity}`,
      "streaming:",
      `  keepalive-seconds: ${policy.streamingKeepaliveSeconds}`,
      `  bootstrap-retries: ${policy.streamingBootstrapRetries}`,
      // Proxy-side output cap and reasoning effort, enforced regardless of
      // what the client requests (upstream payload.override semantics).
      "payload:",
      "  override:",
      "    - models:",
      '        - name: "*"',
      '          protocol: "codex"',
      "      params:",
      `        "max_output_tokens": ${policy.maxOutputTokens}`,
      `        "reasoning.effort": "${policy.reasoningEffort}"`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeSessionConfig(request: LaunchRequest): Promise<string> {
  const sessionsDir = join(request.paths.stateDir, "sessions");
  await ensureOwnerOnlyDir(sessionsDir);
  const configFile = join(sessionsDir, `gateway-${request.port}.yaml`);
  // Contains the per-session client secret, so it must stay owner-only.
  await writeFile(configFile, renderSessionConfig(request), { mode: 0o600 });
  return configFile;
}

/**
 * Writes the persistent-mode gateway configuration referenced by the systemd
 * unit and by login runs. Same rendering (and hard guards) as session mode,
 * but at a stable path with the persistent client secret.
 */
export async function writePersistentConfig(
  paths: ClaudexPaths,
  config: ClaudexConfig,
  clientSecret: string,
): Promise<string> {
  await ensureOwnerOnlyDir(paths.stateDir);
  const configFile = join(paths.stateDir, "gateway-persistent.yaml");
  const rendered = renderSessionConfig({
    host: config.runtime.host,
    port: config.runtime.port,
    clientSecret,
    paths,
    policy: policyFromConfig(config),
  });
  await writeFile(configFile, rendered, { mode: 0o600 });
  return configFile;
}

export function createCliproxyLauncher(): GatewayLauncher {
  return {
    launch: async (request) => {
      const configFile = await writeSessionConfig(request);
      const args = ["--config", configFile];
      if (request.policy?.remoteModelCatalog === false) {
        args.push("--local-model");
      }
      return spawn(request.binaryFile, args, {
        stdio: "ignore",
        detached: false,
      });
    },
  };
}

/** Healthy once the gateway answers an authenticated model-inventory request. */
export const defaultHealthProbe: HealthProbe = async ({ host, port, clientSecret }) => {
  try {
    const response = await fetch(`http://${host}:${port}/v1/models`, {
      headers: { authorization: `Bearer ${clientSecret}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};
