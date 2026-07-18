import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ensureOwnerOnlyDir } from "../security/permissions.js";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export interface LockOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export type LockResult =
  | { readonly ok: true; readonly release: () => Promise<void> }
  | { readonly ok: false; readonly error: string };

/**
 * Serializes login attempts: the security model allows only one active PKCE
 * attempt at a time. The lock is a wx-created owner-only file; stale locks
 * (crashed attempts) are replaced after the ttl.
 */
export async function acquireLoginLock(
  stateDir: string,
  options: LockOptions = {},
): Promise<LockResult> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const lockFile = join(stateDir, "login.lock");
  await ensureOwnerOnlyDir(stateDir);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: now() }), "utf8");
      await handle.close();
      return {
        ok: true,
        release: async () => {
          await rm(lockFile, { force: true });
        },
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const stale = await isStale(lockFile, now(), ttlMs);
      if (!stale) {
        return {
          ok: false,
          error:
            "Another login attempt is already active. Finish or cancel it first; a crashed attempt unlocks automatically after 15 minutes.",
        };
      }
      await rm(lockFile, { force: true });
    }
  }
  return { ok: false, error: "Could not acquire the login lock." };
}

async function isStale(lockFile: string, nowMs: number, ttlMs: number): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lockFile, "utf8"));
    const acquiredAt =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).acquiredAt
        : undefined;
    if (typeof acquiredAt === "number") {
      return nowMs - acquiredAt > ttlMs;
    }
  } catch {
    // Unreadable lock content: treat as stale rather than deadlocking forever.
  }
  return true;
}
