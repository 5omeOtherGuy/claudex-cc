import { chmod, mkdir, stat } from "node:fs/promises";

/**
 * Creates the directory if needed and always tightens it to owner-only.
 * Plain mkdir with a mode leaves pre-existing loose directories untouched;
 * this helper closes that gap. No-op permission-wise on Windows, where POSIX
 * bits are not meaningful.
 */
export async function ensureOwnerOnlyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(dir, 0o700);
  }
}

/**
 * Rejects paths that would break out of generated configuration files, unit
 * files, or shell shims (quotes, control characters, or a leading dash).
 */
export function assertEmbeddablePath(
  path: string,
  purpose: string,
  options?: { readonly allowBackslash?: boolean },
): void {
  // Spaces are fine (all embeddings quote); quotes, escapes, shell/systemd/cmd
  // expansion characters, and control characters are not. Backslash is only
  // acceptable where it is the platform path separator (Windows embeddings).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what must be rejected
  if (/["'$`%\x00-\x1f]/.test(path) || path.startsWith("-")) {
    throw new Error(
      `Refusing to embed a path with quotes, control, or shell metacharacters into ${purpose}.`,
    );
  }
  if (options?.allowBackslash !== true && path.includes("\\")) {
    throw new Error(`Refusing to embed a path with backslashes into ${purpose}.`);
  }
}

/** Fails closed when a secret-bearing file is group- or world-accessible. */
export async function assertOwnerOnlyFile(file: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const info = await stat(file);
  if ((info.mode & 0o077) !== 0) {
    throw new Error(
      `${file} is group- or world-accessible; refusing to use it. Run chmod 600 on the file and retry.`,
    );
  }
}
