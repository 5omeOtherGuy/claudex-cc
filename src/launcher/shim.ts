import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  | { readonly status: "foreign"; readonly file: string };

export async function inspectShim(options: InspectShimOptions): Promise<ShimInspection> {
  const file = join(options.binDir, shimFileName(options.platform));
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (existing === undefined) {
    return { status: "absent", file };
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
  const file = join(options.binDir, shimFileName(options.platform));
  const existing = await readFile(file, "utf8").catch(() => undefined);
  if (existing === undefined) {
    return { ok: true };
  }
  if (!existing.includes(marker(options.platform))) {
    return {
      ok: false,
      error: `${file} is not managed by Claudex; refusing to remove an unrelated executable.`,
    };
  }
  await rm(file, { force: true });
  return { ok: true };
}
