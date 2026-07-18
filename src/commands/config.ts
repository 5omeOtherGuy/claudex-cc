import { DEFAULT_CONFIG } from "../config/defaults.js";
import { applyPreset, findPreset, PRESETS } from "../config/presets.js";
import { loadConfig, saveConfig } from "../config/store.js";
import type { ClaudexPaths } from "../platform/paths.js";

export interface ConfigCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

const USAGE = `Usage:
  claudex-pluginctl config show [--json]
  claudex-pluginctl config set <key> <value>
  claudex-pluginctl config preset [<name>]
  claudex-pluginctl config reset

Keys use dot notation, for example runtime.port or models.main.
Presets: ${PRESETS.map((preset) => preset.name).join(", ")}.
`;

function flatten(value: unknown, prefix: string, lines: string[]): void {
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix === "" ? key : `${prefix}.${key}`, lines);
    }
    return;
  }
  lines.push(`${prefix} = ${JSON.stringify(value)}`);
}

// CLI values arrive as strings; interpret numbers/booleans, keep everything else verbatim.
function parseCliValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function withValueAtPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) {
    throw new Error("Config key must not be empty.");
  }
  const child = target[head];
  return {
    ...target,
    [head]:
      rest.length === 0
        ? value
        : withValueAtPath(
            typeof child === "object" && child !== null ? (child as Record<string, unknown>) : {},
            rest,
            value,
          ),
  };
}

export async function runConfigCommand(
  args: readonly string[],
  paths: ClaudexPaths,
): Promise<ConfigCommandResult> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "show": {
      const loaded = await loadConfig(paths);
      if (!loaded.ok) {
        return { exitCode: 1, output: `${loaded.error}\n` };
      }
      if (rest.includes("--json")) {
        return { exitCode: 0, output: `${JSON.stringify(loaded.config, null, 2)}\n` };
      }
      const lines: string[] = [];
      flatten(loaded.config, "", lines);
      return {
        exitCode: 0,
        output: `# source: ${loaded.source}${loaded.migrated ? " (migrated)" : ""}\n${lines.join("\n")}\n`,
      };
    }
    case "set": {
      const [key, rawValue] = rest.filter((arg) => !arg.startsWith("--"));
      if (key === undefined || rawValue === undefined) {
        return { exitCode: 2, output: USAGE };
      }
      const loaded = await loadConfig(paths);
      if (!loaded.ok) {
        return { exitCode: 1, output: `${loaded.error}\n` };
      }
      const updated = withValueAtPath(
        loaded.config as unknown as Record<string, unknown>,
        key.split("."),
        parseCliValue(rawValue),
      );
      try {
        await saveConfig(paths, updated);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 1, output: `${message}\n` };
      }
      return { exitCode: 0, output: `Set ${key} = ${rawValue}\n` };
    }
    case "preset": {
      const [name] = rest.filter((arg) => !arg.startsWith("--"));
      if (name === undefined) {
        const lines = PRESETS.map((preset) => `${preset.name}: ${preset.description}`);
        return { exitCode: 0, output: `${lines.join("\n")}\n` };
      }
      const preset = findPreset(name);
      if (preset === undefined) {
        return {
          exitCode: 2,
          output: `Unknown preset "${name}". Available: ${PRESETS.map((entry) => entry.name).join(", ")}.\n`,
        };
      }
      const loaded = await loadConfig(paths);
      if (!loaded.ok) {
        return { exitCode: 1, output: `${loaded.error}\n` };
      }
      await saveConfig(paths, applyPreset(loaded.config, preset));
      return {
        exitCode: 0,
        output: `Applied preset "${preset.name}" (reasoning, context, and request policy updated; models and runtime untouched).\nChanges apply to the next \`claudex\` launch; persistent-mode gateways pick them up after \`setup\` or \`update\` rewrites the service config.\n`,
      };
    }
    case "reset": {
      await saveConfig(paths, DEFAULT_CONFIG);
      return {
        exitCode: 0,
        output: `Config reset to defaults (previous version kept at ${paths.configBackupFile}).\n`,
      };
    }
    default:
      return { exitCode: 2, output: USAGE };
  }
}
