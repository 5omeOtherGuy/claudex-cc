import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertEmbeddablePath, ensureOwnerOnlyDir } from "../security/permissions.js";
import type { GatewayLauncher, HealthProbe, LaunchRequest } from "./session.js";

const LOOPBACK_PATTERN = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|localhost)$/;

/**
 * Renders the per-session CLIProxyAPI configuration. Key names follow the
 * upstream config.example.yaml of the pinned release. The gateway stays
 * loopback-only, management stays local, and telemetry stays off.
 */
export function renderSessionConfig(request: LaunchRequest): string {
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
  return [
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
    "",
  ].join("\n");
}

export async function writeSessionConfig(request: LaunchRequest): Promise<string> {
  const sessionsDir = join(request.paths.stateDir, "sessions");
  await ensureOwnerOnlyDir(sessionsDir);
  const configFile = join(sessionsDir, `gateway-${request.port}.yaml`);
  // Contains the per-session client secret, so it must stay owner-only.
  await writeFile(configFile, renderSessionConfig(request), { mode: 0o600 });
  return configFile;
}

export function createCliproxyLauncher(): GatewayLauncher {
  return {
    launch: async (request) => {
      const configFile = await writeSessionConfig(request);
      return spawn(request.binaryFile, ["--config", configFile], {
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
