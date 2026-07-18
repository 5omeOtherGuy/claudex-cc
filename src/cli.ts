#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigCommand } from "./commands/config.js";
import { renderDoctorReport, runDoctor } from "./commands/doctor.js";
import { runLaunchCommand } from "./commands/launch.js";
import { runLoginCommand } from "./commands/login.js";
import { renderSetupReport, runSetup } from "./commands/setup.js";
import { collectStatus, renderStatusReport } from "./commands/status.js";
import { loadConfig } from "./config/store.js";
import { ensurePersistentSecret } from "./launcher/launch.js";
import { defaultHealthProbe } from "./lifecycle/cliproxy.js";
import { resolveCurrentPlatformPaths } from "./platform/paths.js";
import { redactSecrets } from "./security/redaction.js";
import { VERSION } from "./version.js";

const HELP = `Claudex control CLI ${VERSION}

Usage:
  claudex-pluginctl <command> [options]

Commands:
  setup [--json]             Install the pinned gateway, service, and launcher
  login [--browser]          Authenticate Codex (device flow by default);
                             run this in an interactive terminal
  launch [args...]           Start Claude Code through the local gateway
  config show [--json]       Print the effective configuration (redacted)
  config set <key> <value>   Validate and persist one setting
  config reset               Restore defaults, keeping a backup
  status [--json]            Show manager, gateway, auth, and launch readiness
  doctor [--offline] [--json] [--allow-live-inference]
                             Run redacted diagnostics with remediations
  version                    Print the Claudex version
  help                       Show this help

Planned commands:
  update, uninstall
`;

function write(value: string): void {
  process.stdout.write(redactSecrets(value));
}

function writeJson(value: unknown): void {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(argv: readonly string[]): Promise<number> {
  const [command = "help", ...args] = argv;
  const json = args.includes("--json");

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      write(HELP);
      return 0;
    case "version":
    case "--version":
    case "-v":
      write(`${VERSION}\n`);
      return 0;
    case "status": {
      const paths = resolveCurrentPlatformPaths();
      const report = await collectStatus({ paths, probe: defaultHealthProbe });
      if (json) {
        writeJson(report);
      } else {
        write(renderStatusReport(report));
      }
      return report.launch.ready ? 0 : 1;
    }
    case "doctor": {
      const paths = resolveCurrentPlatformPaths();
      const offline = args.includes("--offline");
      const report = await runDoctor({
        paths,
        offline,
        allowLiveInference: args.includes("--allow-live-inference"),
        claudeSettingsFile: join(homedir(), ".claude", "settings.json"),
        clientSecret: offline ? undefined : await ensurePersistentSecret(paths),
      });
      if (json) {
        writeJson(report);
      } else {
        write(renderDoctorReport(report));
      }
      return report.overall === "fail" ? 1 : 0;
    }
    case "config": {
      const result = await runConfigCommand(args, resolveCurrentPlatformPaths());
      write(result.output);
      return result.exitCode;
    }
    case "setup": {
      const paths = resolveCurrentPlatformPaths();
      const report = await runSetup({
        paths,
        platform: process.platform,
        arch: process.arch,
        binDir: join(homedir(), ".local", "bin"),
        managerEntry: fileURLToPath(import.meta.url),
        unitDir: join(homedir(), ".config", "systemd", "user"),
      });
      if (json) {
        writeJson(report);
      } else {
        write(renderSetupReport(report));
      }
      return report.ok ? 0 : 1;
    }
    case "login": {
      const paths = resolveCurrentPlatformPaths();
      const loaded = await loadConfig(paths);
      if (!loaded.ok) {
        write(`${loaded.error}\n`);
        return 1;
      }
      const result = await runLoginCommand({
        paths,
        config: loaded.config,
        mode: args.includes("--browser") ? "browser" : "device",
        onProgress: (line) => write(`${line}\n`),
      });
      write(result.output);
      return result.exitCode;
    }
    case "launch": {
      const paths = resolveCurrentPlatformPaths();
      const loaded = await loadConfig(paths);
      if (!loaded.ok) {
        write(`${loaded.error}\n`);
        return 1;
      }
      const result = await runLaunchCommand({ paths, config: loaded.config, args });
      write(result.output);
      return result.exitCode;
    }
    case "update":
    case "uninstall":
      write(`${command} is planned but not implemented in this repository scaffold.\n`);
      return 2;
    default:
      write(`Unknown command: ${command}\n\n${HELP}`);
      return 64;
  }
}

process.exitCode = await run(process.argv.slice(2));
