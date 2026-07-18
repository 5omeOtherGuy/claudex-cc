import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertEmbeddablePath } from "../security/permissions.js";

const execFileAsync = promisify(execFile);

export const CLAUDEX_AGENT_LABEL = "com.claudex.gateway";
export const CLAUDEX_AGENT_PLIST = `${CLAUDEX_AGENT_LABEL}.plist`;

const MANAGED_MARKER = "<!-- Managed by Claudex -->";

/** Same result shape as the systemd lifecycle for uniform reporting. */
export type AgentResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface LaunchctlRunner {
  run(args: readonly string[]): Promise<{
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  }>;
}

export function createLaunchctlRunner(): LaunchctlRunner {
  return {
    run: async (args) => {
      try {
        const { stdout, stderr } = await execFileAsync("launchctl", [...args]);
        return { code: 0, stdout, stderr };
      } catch (error: unknown) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return {
          code: typeof failure.code === "number" ? failure.code : 1,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? "",
        };
      }
    },
  };
}

export interface AgentOptions {
  readonly binaryFile: string;
  readonly configFile: string;
  /** Start the gateway with its embedded model catalog only (--local-model). */
  readonly localModelCatalog?: boolean | undefined;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * LaunchAgent definition for the persistent gateway. Umask 63 is decimal for
 * 0o077: everything launchd starts for us stays owner-only. KeepAlive
 * restarts crashes but respects a clean stop.
 */
export function renderLaunchAgentPlist(options: AgentOptions): string {
  assertEmbeddablePath(options.binaryFile, "the launch agent");
  assertEmbeddablePath(options.configFile, "the launch agent");
  const args = [options.binaryFile, "--config", options.configFile];
  if (options.localModelCatalog === true) {
    args.push("--local-model");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    MANAGED_MARKER,
    "<!-- Reinstalling Claudex rewrites this file; manual edits are overwritten. -->",
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${CLAUDEX_AGENT_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>Umask</key>",
    "  <integer>63</integer>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

async function findForeignProxyAgents(agentDir: string): Promise<string[]> {
  const entries = await readdir(agentDir).catch(() => [] as string[]);
  const foreign: string[] = [];
  for (const name of entries.filter(
    (entry) => entry.endsWith(".plist") && entry !== CLAUDEX_AGENT_PLIST,
  )) {
    const content = await readFile(join(agentDir, name), "utf8").catch(() => "");
    if (content.includes("cli-proxy-api")) {
      foreign.push(name);
    }
  }
  return foreign;
}

export interface InstallAgentOptions extends AgentOptions {
  /** Typically ~/Library/LaunchAgents. */
  readonly agentDir: string;
  readonly runner: LaunchctlRunner;
  /** The gui domain target, i.e. the numeric user id. */
  readonly uid: number;
}

function domainTarget(uid: number): string {
  return `gui/${uid}`;
}

function serviceTarget(uid: number): string {
  return `${domainTarget(uid)}/${CLAUDEX_AGENT_LABEL}`;
}

export async function installLaunchAgent(options: InstallAgentOptions): Promise<AgentResult> {
  // Never take over gateways this manager does not own.
  const foreign = await findForeignProxyAgents(options.agentDir);
  if (foreign.length > 0) {
    return {
      ok: false,
      error: `Refusing to install: existing CLIProxyAPI launch agent(s) found (${foreign.join(", ")}). Claudex never overwrites unrelated gateway installations.`,
    };
  }

  const plistFile = join(options.agentDir, CLAUDEX_AGENT_PLIST);
  const existing = await readFile(plistFile, "utf8").catch(() => undefined);
  const existedBefore = existing !== undefined;
  if (existing !== undefined && !existing.includes(MANAGED_MARKER)) {
    return {
      ok: false,
      error: `${CLAUDEX_AGENT_PLIST} exists but is not managed by Claudex; refusing to overwrite it.`,
    };
  }

  await mkdir(options.agentDir, { recursive: true });
  await writeFile(
    plistFile,
    renderLaunchAgentPlist({
      binaryFile: options.binaryFile,
      configFile: options.configFile,
      localModelCatalog: options.localModelCatalog,
    }),
    { mode: 0o644 },
  );

  // Re-bootstrapping an already-loaded label fails; boot it out first so the
  // install is idempotent and picks up plist changes.
  await options.runner.run(["bootout", serviceTarget(options.uid)]);
  const bootstrap = await options.runner.run(["bootstrap", domainTarget(options.uid), plistFile]);
  if (bootstrap.code !== 0) {
    if (!existedBefore) {
      await rm(plistFile, { force: true });
    }
    return {
      ok: false,
      error: `launchctl bootstrap failed: ${bootstrap.stderr.trim() || `exit ${bootstrap.code}`}`,
    };
  }
  return { ok: true };
}

export async function startLaunchAgent(runner: LaunchctlRunner, uid: number): Promise<AgentResult> {
  const result = await runner.run(["kickstart", serviceTarget(uid)]);
  return result.code === 0
    ? { ok: true }
    : {
        ok: false,
        error: `launchctl kickstart failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
}

export async function restartLaunchAgent(
  runner: LaunchctlRunner,
  uid: number,
): Promise<AgentResult> {
  const result = await runner.run(["kickstart", "-k", serviceTarget(uid)]);
  return result.code === 0
    ? { ok: true }
    : {
        ok: false,
        error: `launchctl kickstart -k failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
}

export interface RemoveAgentOptions {
  readonly agentDir: string;
  readonly runner: LaunchctlRunner;
  readonly uid: number;
}

export async function removeLaunchAgent(options: RemoveAgentOptions): Promise<AgentResult> {
  const plistFile = join(options.agentDir, CLAUDEX_AGENT_PLIST);
  const existing = await readFile(plistFile, "utf8").catch(() => undefined);
  if (existing === undefined) {
    return { ok: true };
  }
  if (!existing.includes(MANAGED_MARKER)) {
    return {
      ok: false,
      error: `${CLAUDEX_AGENT_PLIST} is not managed by Claudex; refusing to remove it.`,
    };
  }
  await options.runner.run(["bootout", serviceTarget(options.uid)]);
  await rm(plistFile, { force: true });
  return { ok: true };
}

/** LaunchAgent management needs a reachable per-user gui domain. */
export async function resolveDarwinServiceMode(
  runner: LaunchctlRunner,
  uid: number,
): Promise<"launchd" | "session"> {
  try {
    const result = await runner.run(["print", domainTarget(uid)]);
    return result.code === 0 ? "launchd" : "session";
  } catch {
    return "session";
  }
}
