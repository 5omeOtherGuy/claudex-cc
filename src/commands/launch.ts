import { spawn } from "node:child_process";
import { inspectCredentialMetadata } from "../auth/metadata.js";
import type { ClaudexConfig } from "../config/defaults.js";
import { getActiveGateway } from "../gateway/activate.js";
import type { ClaudeSpawn } from "../launcher/launch.js";
import { executeClaude, prepareLaunch } from "../launcher/launch.js";
import { createCliproxyLauncher, defaultHealthProbe } from "../lifecycle/cliproxy.js";
import type { GatewayLauncher, HealthProbe } from "../lifecycle/session.js";
import { buildClaudeEnv, startSessionGateway } from "../lifecycle/session.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface LaunchCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface LaunchCommandOptions {
  readonly paths: ClaudexPaths;
  readonly config: ClaudexConfig;
  /** Arguments forwarded verbatim to Claude Code. */
  readonly args: readonly string[];
  readonly claudeCommand?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly spawnFn?: ClaudeSpawn;
  readonly probe?: HealthProbe;
  readonly launcher?: GatewayLauncher;
}

const defaultClaudeSpawn: ClaudeSpawn = (command, args, options) =>
  spawn(command, [...args], { env: options.env, stdio: "inherit" });

/**
 * The `claudex` launcher entry: prepares a healthy authenticated gateway
 * (persistent service or per-session process) and then hands the terminal to
 * Claude Code with the isolated gateway environment.
 */
export async function runLaunchCommand(
  options: LaunchCommandOptions,
): Promise<LaunchCommandResult> {
  const probe = options.probe ?? defaultHealthProbe;
  const spawnFn = options.spawnFn ?? defaultClaudeSpawn;
  const claudeCommand = options.claudeCommand ?? "claude";
  const baseEnv = options.baseEnv ?? process.env;

  let env: Record<string, string>;
  let cleanup: () => Promise<void> = async () => {};

  if (options.config.runtime.mode === "persistent") {
    const prepared = await prepareLaunch({ paths: options.paths, config: options.config, probe });
    if (!prepared.ok) {
      return {
        exitCode: 1,
        output: `Cannot launch (${prepared.reason}). ${prepared.remediation}\n`,
      };
    }
    env = prepared.env;
  } else {
    const active = await getActiveGateway(options.paths);
    if (active === undefined) {
      return {
        exitCode: 1,
        output:
          "Cannot launch (gateway_missing). No gateway version is installed and activated. Run setup first.\n",
      };
    }
    const credentials = await inspectCredentialMetadata(options.paths.credentialsDir);
    if (!credentials.present) {
      return {
        exitCode: 1,
        output:
          "Cannot launch (not_logged_in). No Codex credentials are present. Run login first.\n",
      };
    }
    // Ephemeral port: concurrent `claudex` sessions each get their own
    // loopback gateway instead of racing for the configured persistent port.
    const session = await startSessionGateway({
      paths: options.paths,
      config: options.config,
      binaryFile: active.binaryFile,
      launcher: options.launcher ?? createCliproxyLauncher(),
      probe,
      port: 0,
    });
    if (!session.ok) {
      return { exitCode: 1, output: `Cannot launch (${session.reason}). ${session.error}\n` };
    }
    env = buildClaudeEnv(session.session, options.config);
    cleanup = async () => session.session.stop();
  }

  const exitCode = await executeClaude({
    claudeCommand,
    args: options.args,
    env,
    baseEnv,
    spawnFn,
    cleanup,
  });
  return { exitCode, output: "" };
}
