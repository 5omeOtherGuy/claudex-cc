#!/usr/bin/env node

import { runConfigCommand } from "./commands/config.js";
import { createOfflineDoctorReport } from "./commands/doctor.js";
import { resolveCurrentPlatformPaths } from "./platform/paths.js";
import { redactSecrets } from "./security/redaction.js";
import { VERSION } from "./version.js";

const HELP = `Claudex control CLI ${VERSION}

Usage:
  claudex-pluginctl <command> [options]

Commands:
  config show [--json]       Print the effective configuration (redacted)
  config set <key> <value>   Validate and persist one setting
  config reset               Restore defaults, keeping a backup
  doctor --offline [--json]  Run safe local scaffold diagnostics
  status [--json]            Show current implementation status
  version                    Print the Claudex version
  help                       Show this help

Planned commands:
  setup, login, update, uninstall, launch
`;

function write(value: string): void {
  process.stdout.write(redactSecrets(value));
}

function writeJson(value: unknown): void {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

function printStatus(json: boolean): void {
  const status = {
    status: "scaffold",
    version: VERSION,
    usable: false,
    nextMilestone: "v0.1.0 Linux manager MVP",
  } as const;

  if (json) {
    writeJson(status);
    return;
  }

  write(`Claudex ${VERSION}: repository scaffold only; runtime setup is not implemented.\n`);
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
    case "status":
      printStatus(json);
      return 0;
    case "doctor": {
      if (!args.includes("--offline")) {
        write("doctor currently requires --offline; live checks are not implemented.\n");
        return 2;
      }
      const report = createOfflineDoctorReport();
      if (json) {
        writeJson(report);
      } else {
        write(`Claudex ${report.claudexVersion} offline doctor: ${report.status}\n`);
        write(`Platform: ${report.platform}/${report.architecture} (${report.osRelease})\n`);
        write(`Pinned gateway: CLIProxyAPI ${report.gatewayVersion}\n`);
        write(`${report.note}\n`);
      }
      return 0;
    }
    case "config": {
      const result = await runConfigCommand(args, resolveCurrentPlatformPaths());
      write(result.output);
      return result.exitCode;
    }
    case "setup":
    case "login":
    case "update":
    case "uninstall":
    case "launch":
      write(`${command} is planned but not implemented in this repository scaffold.\n`);
      return 2;
    default:
      write(`Unknown command: ${command}\n\n${HELP}`);
      return 64;
  }
}

process.exitCode = await run(process.argv.slice(2));
