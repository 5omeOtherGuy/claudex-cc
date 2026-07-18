import { randomBytes } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudexPaths } from "../platform/paths.js";

export interface ActiveGateway {
  readonly version: string;
  readonly binaryFile: string;
}

export type ActivationResult =
  | { readonly ok: true; readonly active: ActiveGateway }
  | { readonly ok: false; readonly error: string };

function pointerFile(paths: ClaudexPaths): string {
  return join(paths.dataDir, "gateway", "active.json");
}

function pointerBackupFile(paths: ClaudexPaths): string {
  return join(paths.dataDir, "gateway", "active.json.bak");
}

async function readPointer(file: string): Promise<ActiveGateway | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).version === "string" &&
      typeof (parsed as Record<string, unknown>).binaryFile === "string"
    ) {
      return parsed as unknown as ActiveGateway;
    }
  } catch {
    // Corrupt pointer files are treated as "nothing active" and rewritten on
    // the next activation; the versions themselves are untouched.
  }
  return undefined;
}

async function writePointer(paths: ClaudexPaths, active: ActiveGateway): Promise<void> {
  const gatewayDir = join(paths.dataDir, "gateway");
  await mkdir(gatewayDir, { recursive: true, mode: 0o700 });
  const tempFile = join(gatewayDir, `active.json.tmp-${randomBytes(6).toString("hex")}`);
  const handle = await open(tempFile, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(active, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await copyFile(pointerFile(paths), pointerBackupFile(paths)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    });
    await rename(tempFile, pointerFile(paths));
  } catch (error: unknown) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

export async function getActiveGateway(paths: ClaudexPaths): Promise<ActiveGateway | undefined> {
  return readPointer(pointerFile(paths));
}

export async function activateGatewayVersion(
  paths: ClaudexPaths,
  version: string,
  binaryName: string,
): Promise<ActivationResult> {
  const binaryFile = join(paths.dataDir, "gateway", "versions", version, binaryName);
  try {
    await stat(binaryFile);
  } catch {
    return {
      ok: false,
      error: `Gateway version ${version} is not installed (missing ${binaryFile}); refusing to activate.`,
    };
  }

  const active: ActiveGateway = { version, binaryFile };
  await writePointer(paths, active);
  return { ok: true, active };
}

export async function rollbackGatewayActivation(paths: ClaudexPaths): Promise<ActivationResult> {
  const previous = await readPointer(pointerBackupFile(paths));
  if (previous === undefined) {
    return { ok: false, error: "No previous gateway activation to roll back to." };
  }
  try {
    await stat(previous.binaryFile);
  } catch {
    return {
      ok: false,
      error: `Previous gateway version ${previous.version} is no longer installed; refusing to roll back.`,
    };
  }
  await writePointer(paths, previous);
  return { ok: true, active: previous };
}
