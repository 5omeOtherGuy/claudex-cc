import type { ClaudexConfig } from "./defaults.js";
import { CONFIG_VERSION, type ConfigValidationError, validateConfig } from "./schema.js";

export type MigrationResult =
  | { readonly ok: true; readonly config: ClaudexConfig; readonly migrated: boolean }
  | {
      readonly ok: false;
      readonly error: string;
      readonly validationErrors?: readonly ConfigValidationError[];
    };

type MigrationStep = (config: Record<string, unknown>) => Record<string, unknown>;

// Index N migrates version N to N+1. Version 0 is the unversioned scaffold format.
const MIGRATIONS: readonly MigrationStep[] = [(config) => ({ ...config, configVersion: 1 })];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateConfig(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    return { ok: false, error: "Config must be a JSON object." };
  }

  const initialVersion = typeof raw.configVersion === "number" ? raw.configVersion : 0;
  if (initialVersion > CONFIG_VERSION) {
    return {
      ok: false,
      error: `Config version ${initialVersion} is newer than this Claudex supports (${CONFIG_VERSION}). Update Claudex instead of editing the file.`,
    };
  }

  let current = raw;
  for (let version = initialVersion; version < CONFIG_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      return { ok: false, error: `No migration path from config version ${version}.` };
    }
    current = step(current);
  }

  const validated = validateConfig(current);
  if (!validated.ok) {
    return {
      ok: false,
      error: "Config failed validation after migration.",
      validationErrors: validated.errors,
    };
  }
  return { ok: true, config: validated.config, migrated: initialVersion !== CONFIG_VERSION };
}
