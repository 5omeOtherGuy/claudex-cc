import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ClaudexPaths } from "../platform/paths.js";
import { type GatewayManifest, selectArtifact } from "./manifest.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

export interface DownloadRequest {
  readonly url: string;
  readonly destination: string;
  readonly signal: AbortSignal;
}

export type Downloader = (request: DownloadRequest) => Promise<void>;

export interface ExtractRequest {
  readonly archiveFile: string;
  readonly targetDir: string;
}

export type Extractor = (request: ExtractRequest) => Promise<void>;

export type InstallResult =
  | { readonly ok: true; readonly version: string; readonly binaryFile: string }
  | { readonly ok: false; readonly error: string };

export interface InstallOptions {
  readonly paths: ClaudexPaths;
  readonly manifest: GatewayManifest;
  readonly platform: string;
  readonly arch: string;
  readonly downloader?: Downloader;
  readonly extractor?: Extractor;
  readonly timeoutMs?: number;
}

const defaultDownloader: Downloader = async ({ url, destination, signal }) => {
  const response = await fetch(url, { redirect: "follow", signal });
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  // fetch() returns the DOM ReadableStream type; at runtime it is the same
  // web stream Readable.fromWeb consumes.
  const body = response.body as unknown as import("node:stream/web").ReadableStream;
  await pipeline(Readable.fromWeb(body), createWriteStream(destination, { mode: 0o600 }), {
    signal,
  });
};

// bsdtar (macOS, Windows 10+) and GNU tar (Linux) both unpack .tar.gz; the
// .zip assets only occur on Windows, where bsdtar handles them as well.
const defaultExtractor: Extractor = async ({ archiveFile, targetDir }) => {
  await execFileAsync("tar", ["-xf", archiveFile, "-C", targetDir]);
};

export async function installGatewayVersion(options: InstallOptions): Promise<InstallResult> {
  const selection = selectArtifact(options.manifest, options.platform, options.arch);
  if (!selection.ok) {
    return selection;
  }
  const artifact = selection.artifact;
  if (!artifact.url.startsWith("https://")) {
    return { ok: false, error: `Refusing non-https artifact URL for ${artifact.assetName}.` };
  }

  const downloader = options.downloader ?? defaultDownloader;
  const extractor = options.extractor ?? defaultExtractor;
  const gatewayDir = join(options.paths.dataDir, "gateway");
  const downloadsDir = join(gatewayDir, "downloads");
  const versionsDir = join(gatewayDir, "versions");
  const versionDir = join(versionsDir, options.manifest.version);

  await mkdir(downloadsDir, { recursive: true, mode: 0o700 });
  await mkdir(versionsDir, { recursive: true, mode: 0o700 });

  const downloadFile = join(
    downloadsDir,
    `${artifact.assetName}.${randomBytes(6).toString("hex")}.partial`,
  );
  const stagingDir = join(versionsDir, `.staging-${randomBytes(6).toString("hex")}`);
  const abort = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await downloader({ url: artifact.url, destination: downloadFile, signal: abort });

    const digest = createHash("sha256")
      .update(await readFile(downloadFile))
      .digest("hex");
    if (digest !== artifact.sha256) {
      return {
        ok: false,
        error: `Checksum mismatch for ${artifact.assetName}: expected ${artifact.sha256}, got ${digest}. The download was discarded and nothing was executed.`,
      };
    }

    // Extract into a hidden staging directory, then activate the version
    // directory with a single atomic rename.
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    await extractor({ archiveFile: downloadFile, targetDir: stagingDir });
    await rm(versionDir, { recursive: true, force: true });
    await rename(stagingDir, versionDir);

    return {
      ok: true,
      version: options.manifest.version,
      binaryFile: join(versionDir, artifact.binaryName),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Gateway install failed: ${message}` };
  } finally {
    await rm(downloadFile, { force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
}
