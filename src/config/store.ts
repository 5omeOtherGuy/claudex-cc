import { randomBytes } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudexPaths } from "../platform/paths.js";
import { type ClaudexConfig, DEFAULT_CONFIG } from "./defaults.js";
import { migrateConfig } from "./migrations.js";
import { validateConfig } from "./schema.js";

export type LoadResult =
  | {
      readonly ok: true;
      readonly config: ClaudexConfig;
      readonly source: "file" | "defaults";
      readonly migrated: boolean;
    }
  | { readonly ok: false; readonly error: string };

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function loadConfig(paths: ClaudexPaths): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return { ok: true, config: DEFAULT_CONFIG, source: "defaults", migrated: false };
    }
    throw new Error(`Could not read ${paths.configFile}.`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `${paths.configFile} is not valid JSON. Restore it from ${paths.configBackupFile} or run \`config reset\`.`,
    };
  }

  const migration = migrateConfig(parsed);
  if (!migration.ok) {
    const details = migration.validationErrors
      ?.map((entry) => `  ${entry.path}: ${entry.message}`)
      .join("\n");
    return {
      ok: false,
      error: details === undefined ? migration.error : `${migration.error}\n${details}`,
    };
  }
  return { ok: true, config: migration.config, source: "file", migrated: migration.migrated };
}

export async function saveConfig(paths: ClaudexPaths, config: unknown): Promise<ClaudexConfig> {
  const validated = validateConfig(config);
  if (!validated.ok) {
    const details = validated.errors.map((entry) => `  ${entry.path}: ${entry.message}`).join("\n");
    throw new Error(`Refusing to save an invalid config:\n${details}`);
  }

  // Owner-only directory before any file exists inside it (fail closed).
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });

  const tempFile = join(paths.configDir, `config.json.tmp-${randomBytes(6).toString("hex")}`);
  const handle = await open(tempFile, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(validated.config, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    // Keep the previous version recoverable, then swap in the new file atomically.
    await copyFile(paths.configFile, paths.configBackupFile).catch((error: unknown) => {
      if (!isMissingFileError(error)) {
        throw error;
      }
    });
    await rename(tempFile, paths.configFile);
  } catch (error: unknown) {
    await rm(tempFile, { force: true });
    throw new Error(`Could not persist ${paths.configFile}.`, { cause: error });
  }
  return validated.config;
}
