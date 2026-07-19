#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConfigCommand } from "./commands/config.js";
import { renderDoctorReport, runDoctor } from "./commands/doctor.js";
import { runLaunchCommand } from "./commands/launch.js";
import { runLoginCommand } from "./commands/login.js";
import { renderRollbackReport, runRollbackCommand } from "./commands/rollback.js";
import {
  buildSetupPlan,
  renderSetupReport,
  runSetup,
  runSetupPreflight,
} from "./commands/setup.js";
import { collectStatus, renderStatusReport } from "./commands/status.js";
import { renderUninstallReport, runUninstall } from "./commands/uninstall.js";
import { renderUpdateReport, runUpdateCommand } from "./commands/update.js";
import { loadConfig } from "./config/store.js";
import { ensurePersistentSecret } from "./launcher/launch.js";
import { defaultHealthProbe } from "./lifecycle/cliproxy.js";
import { resolveCurrentLauncherBinDir, resolveCurrentPlatformPaths } from "./platform/paths.js";
import { redactSecrets } from "./security/redaction.js";
import { VERSION } from "./version.js";

const HELP = `Claudex control CLI ${VERSION}

Usage:
  claudex-pluginctl <command> [options]

Commands:
  setup [--json]             Install the pinned gateway, service, and launcher
  setup --plan               Print the machine-readable guided-setup contract
  setup --preflight          Check setup blockers and warnings without changes
  login [--browser]          Authenticate Codex; device flow is the terminal
                             default and browser flow supports plugin-guided login
  launch [args...]           Start Claude Code through the local gateway
  config show [--json]       Print the effective configuration (redacted)
  config set <key> <value>   Validate and persist one setting
  config reset               Restore defaults, keeping a backup
  status [--json]            Show manager, gateway, auth, and launch readiness
  doctor [--offline] [--json] [--allow-live-inference]
                             Run redacted diagnostics with remediations
  update [--check] [--json] [--allow-live-inference]
                             Show or apply the pinned gateway update; staged
                             smoke checks gate activation, with rollback
  rollback [--json]          Reactivate the previously active gateway version
  uninstall (--keep-credentials | --delete-credentials) [--delete-config] [--json]
                             Remove Claudex-managed components; the credential
                             choice is explicit and separate
  version                    Print the Claudex version
  help                       Show this help
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
      const preflightOptions = {
        paths,
        platform: process.platform,
        arch: process.arch,
        binDir: resolveCurrentLauncherBinDir(),
        pathValue: process.env.PATH,
        claudeSettingsFile: join(homedir(), ".claude", "settings.json"),
      };
      if (args.includes("--preflight")) {
        const preflight = await runSetupPreflight(preflightOptions);
        writeJson(preflight);
        return preflight.ok ? 0 : 1;
      }
      if (args.includes("--plan")) {
        const loaded = await loadConfig(paths);
        if (!loaded.ok) {
          write(`${loaded.error}\n`);
          return 1;
        }
        writeJson(buildSetupPlan(loaded.config));
        return 0;
      }
      const report = await runSetup({
        ...preflightOptions,
        managerEntry: fileURLToPath(import.meta.url),
        unitDir: join(homedir(), ".config", "systemd", "user"),
        agentDir: join(homedir(), "Library", "LaunchAgents"),
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
    case "update": {
      const paths = resolveCurrentPlatformPaths();
      const report = await runUpdateCommand({
        paths,
        platform: process.platform,
        arch: process.arch,
        unitDir: join(homedir(), ".config", "systemd", "user"),
        agentDir: join(homedir(), "Library", "LaunchAgents"),
        apply: !args.includes("--check"),
        allowLiveInference: args.includes("--allow-live-inference"),
      });
      if (json) {
        writeJson(report);
      } else {
        write(renderUpdateReport(report));
      }
      return report.ok ? 0 : 1;
    }
    case "rollback": {
      const paths = resolveCurrentPlatformPaths();
      const report = await runRollbackCommand({
        paths,
        platform: process.platform,
        unitDir: join(homedir(), ".config", "systemd", "user"),
        agentDir: join(homedir(), "Library", "LaunchAgents"),
      });
      if (json) {
        writeJson(report);
      } else {
        write(renderRollbackReport(report));
      }
      return report.ok ? 0 : 1;
    }
    case "uninstall": {
      const keep = args.includes("--keep-credentials");
      const remove = args.includes("--delete-credentials");
      if (keep === remove) {
        write(
          "Uninstall needs an explicit credential decision: pass exactly one of --keep-credentials or --delete-credentials.\n",
        );
        return 64;
      }
      const paths = resolveCurrentPlatformPaths();
      const report = await runUninstall({
        paths,
        platform: process.platform,
        binDir: resolveCurrentLauncherBinDir(),
        unitDir: join(homedir(), ".config", "systemd", "user"),
        agentDir: join(homedir(), "Library", "LaunchAgents"),
        removeCredentials: remove,
        removeConfig: args.includes("--delete-config"),
      });
      if (json) {
        writeJson(report);
      } else {
        write(renderUninstallReport(report));
      }
      return report.ok ? 0 : 1;
    }
    default:
      write(`Unknown command: ${command}\n\n${HELP}`);
      return 64;
  }
}

process.exitCode = await run(process.argv.slice(2));
