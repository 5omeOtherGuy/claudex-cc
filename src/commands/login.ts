import { createCliproxyLoginDriver } from "../auth/cliproxy-driver.js";
import { createFileValidator } from "../auth/metadata.js";
import type { AuthValidator, LoginDriver, LoginMode } from "../auth/orchestrator.js";
import { runLogin } from "../auth/orchestrator.js";
import type { ClaudexConfig } from "../config/defaults.js";
import { getActiveGateway } from "../gateway/activate.js";
import { ensurePersistentSecret } from "../launcher/launch.js";
import {
  createCliproxyLauncher,
  defaultHealthProbe,
  writePersistentConfig,
} from "../lifecycle/cliproxy.js";
import { startSessionGateway } from "../lifecycle/session.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface LoginCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface LoginCommandOptions {
  readonly paths: ClaudexPaths;
  readonly config: ClaudexConfig;
  readonly mode: LoginMode;
  readonly onProgress: (line: string) => void;
  readonly driverFactory?: (binaryFile: string, configFile: string) => LoginDriver;
  readonly probe?: AuthValidator["probe"];
  readonly timeoutMs?: number;
}

/**
 * Default post-login probe: one authenticated model-inventory request through
 * the persistent gateway if it is up, otherwise through a short-lived session
 * gateway using the freshly persisted credentials.
 */
function createDefaultProbe(
  paths: ClaudexPaths,
  config: ClaudexConfig,
  binaryFile: string,
): AuthValidator["probe"] {
  return async () => {
    const { host, port } = config.runtime;
    const clientSecret = await ensurePersistentSecret(paths);
    if (await defaultHealthProbe({ host, port, clientSecret })) {
      return { ok: true };
    }
    const session = await startSessionGateway({
      paths,
      config,
      binaryFile,
      launcher: createCliproxyLauncher(),
      probe: defaultHealthProbe,
      port: 0,
    });
    if (!session.ok) {
      return { ok: false, status: "network", detail: session.error };
    }
    await session.session.stop();
    return { ok: true };
  };
}

export async function runLoginCommand(options: LoginCommandOptions): Promise<LoginCommandResult> {
  const active = await getActiveGateway(options.paths);
  if (active === undefined) {
    return {
      exitCode: 1,
      output: "No gateway is installed and activated. Run `claudex-pluginctl setup` first.\n",
    };
  }

  const clientSecret = await ensurePersistentSecret(options.paths);
  const configFile = await writePersistentConfig(options.paths, options.config, clientSecret);

  const driver =
    options.driverFactory !== undefined
      ? options.driverFactory(active.binaryFile, configFile)
      : createCliproxyLoginDriver({ binaryFile: active.binaryFile, configFile });
  const validator = createFileValidator(
    options.paths.credentialsDir,
    options.probe ?? createDefaultProbe(options.paths, options.config, active.binaryFile),
  );

  const result = await runLogin({
    paths: options.paths,
    driver,
    validator,
    mode: options.mode,
    onProgress: options.onProgress,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  if (result.ok) {
    return {
      exitCode: 0,
      output:
        "Login succeeded and was verified with an authenticated request.\nStart Claude Code through the `claudex` launcher to use the gateway.\n",
    };
  }
  const detail = result.detail === undefined ? "" : `Detail: ${result.detail}\n`;
  return {
    exitCode: 1,
    output: `Login failed (${result.reason}).\n${detail}${result.remediation}\n`,
  };
}
