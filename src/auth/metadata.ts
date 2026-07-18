import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AuthValidator } from "./orchestrator.js";

/**
 * Safe-to-print credential metadata. Token contents, account identifiers, and
 * e-mail addresses are never extracted from the credential file.
 */
export interface CredentialMetadata {
  readonly present: boolean;
  readonly ownerOnly: boolean;
  readonly expiresAt?: string | undefined;
  readonly modifiedAt?: string | undefined;
}

async function credentialFiles(credentialsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(credentialsDir);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(credentialsDir, name));
  } catch {
    return [];
  }
}

function isOwnerOnly(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

export async function inspectCredentialMetadata(
  credentialsDir: string,
): Promise<CredentialMetadata> {
  const files = await credentialFiles(credentialsDir);
  const file = files[0];
  if (file === undefined) {
    return { present: false, ownerOnly: false };
  }

  const info = await stat(file);
  let expiresAt: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const expiry = (parsed as Record<string, unknown>).expired;
      if (typeof expiry === "string") {
        expiresAt = expiry;
      }
    }
  } catch {
    // Unreadable credential content is the gateway's concern; metadata stays partial.
  }

  return {
    present: true,
    ownerOnly: isOwnerOnly(info.mode),
    expiresAt,
    modifiedAt: info.mtime.toISOString(),
  };
}

/**
 * Builds the standard validator: persistence means an owner-only credential
 * file exists; the authenticated probe is injected (it needs a running
 * gateway, which the session lifecycle owns).
 */
export function createFileValidator(
  credentialsDir: string,
  probe: AuthValidator["probe"],
): AuthValidator {
  return {
    checkPersisted: async () => {
      const metadata = await inspectCredentialMetadata(credentialsDir);
      if (!metadata.present) {
        return { ok: false, detail: `No credential file found in ${credentialsDir}.` };
      }
      if (!metadata.ownerOnly) {
        return {
          ok: false,
          detail:
            "Credential file permissions are not owner-only; refusing to treat the login as successful.",
        };
      }
      return { ok: true };
    },
    probe,
  };
}
