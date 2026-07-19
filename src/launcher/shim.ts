import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertEmbeddablePath } from "../security/permissions.js";

const POSIX_MARKER = "# Managed by Claudex";
const CMD_MARKER = "rem Managed by Claudex";

export type ShimResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function shimFileName(platform: string): string {
  return platform === "win32" ? "claudex.cmd" : "claudex";
}

/**
 * The stable launcher is a tiny shim outside any versioned plugin cache
 * (ADR 0002). It only delegates to the manager CLI, which prepares the
 * gateway before Claude Code starts.
 */
export function renderShim(platform: string, managerEntry: string): string {
  assertEmbeddablePath(managerEntry, "the claudex launcher shim", {
    allowBackslash: platform === "win32",
  });
  if (platform === "win32") {
    return [
      "@echo off",
      CMD_MARKER,
      "rem Reinstalling Claudex rewrites this file.",
      `node "${managerEntry}" launch %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/usr/bin/env bash",
    POSIX_MARKER,
    "# Reinstalling Claudex rewrites this file.",
    "set -euo pipefail",
    `exec node "${managerEntry}" launch "$@"`,
    "",
  ].join("\n");
}

function marker(platform: string): string {
  return platform === "win32" ? CMD_MARKER : POSIX_MARKER;
}

export interface InspectShimOptions {
  readonly binDir: string;
  readonly platform: string;
}

export type ShimInspection =
  | { readonly status: "absent"; readonly file: string }
  | { readonly status: "managed"; readonly file: string }
  | { readonly status: "foreign"; readonly file: string }
  | { readonly status: "blocked"; readonly file: string; readonly error: string };

export async function inspectShim(options: InspectShimOptions): Promise<ShimInspection> {
  const file = join(options.binDir, shimFileName(options.platform));
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(file);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent", file };
    }
    return { status: "blocked", file, error: `${file} cannot be inspected safely.` };
  }
  if (!info.isFile()) {
    return { status: "blocked", file, error: `${file} is not a regular file.` };
  }

  let existing: string;
  try {
    const handle = await open(file, "r");
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
        return { status: "blocked", file, error: `${file} changed during inspection.` };
      }
      existing = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "blocked", file, error: `${file} is not readable.` };
  }
  return existing.includes(marker(options.platform))
    ? { status: "managed", file }
    : { status: "foreign", file };
}

export interface InstallShimOptions {
  readonly binDir: string;
  readonly platform: string;
  readonly managerEntry: string;
}

export async function installShim(options: InstallShimOptions): Promise<ShimResult> {
  const inspection = await inspectShim(options);
  const file = inspection.file;
  if (inspection.status === "foreign") {
    return {
      ok: false,
      error: `${file} exists but is not managed by Claudex; refusing to overwrite it. Remove or rename the conflicting launcher first.`,
    };
  }
  if (inspection.status === "blocked") {
    return { ok: false, error: inspection.error };
  }

  await mkdir(options.binDir, { recursive: true });
  const tempFile = `${file}.tmp`;
  await writeFile(tempFile, renderShim(options.platform, options.managerEntry), { mode: 0o755 });
  await chmod(tempFile, 0o755);
  await rename(tempFile, file);
  return { ok: true };
}

export interface RemoveShimOptions {
  readonly binDir: string;
  readonly platform: string;
}

export async function removeShim(options: RemoveShimOptions): Promise<ShimResult> {
  const inspection = await inspectShim(options);
  if (inspection.status === "absent") {
    return { ok: true };
  }
  if (inspection.status === "blocked") {
    return { ok: false, error: inspection.error };
  }
  if (inspection.status === "foreign") {
    return {
      ok: false,
      error: `${inspection.file} is not managed by Claudex; refusing to remove an unrelated executable.`,
    };
  }
  await rm(inspection.file, { force: true });
  return { ok: true };
}
