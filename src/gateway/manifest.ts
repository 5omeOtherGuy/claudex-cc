export interface GatewayArtifact {
  readonly assetName: string;
  readonly url: string;
  /** SHA-256 of the release asset, copied from the reviewed upstream checksums.txt. */
  readonly sha256: string;
  readonly archive: "tar.gz" | "zip";
  /** Path of the executable inside the extracted archive root. */
  readonly binaryName: string;
}

export interface GatewayManifest {
  readonly version: string;
  /** Keyed by `${process.platform}-${process.arch}`. */
  readonly artifacts: Readonly<Record<string, GatewayArtifact>>;
}

export type ArtifactSelection =
  | { readonly ok: true; readonly artifact: GatewayArtifact }
  | { readonly ok: false; readonly error: string };

const RELEASE_BASE = "https://github.com/router-for-me/CLIProxyAPI/releases/download";

function artifact(
  version: string,
  assetName: string,
  sha256: string,
  archive: GatewayArtifact["archive"],
  binaryName: string,
): GatewayArtifact {
  return {
    assetName,
    url: `${RELEASE_BASE}/v${version}/${assetName}`,
    sha256,
    archive,
    binaryName,
  };
}

// Hashes are transcribed from the upstream v7.2.86 checksums.txt release asset
// and additionally verified against a downloaded linux/amd64 archive.
const VERSION = "7.2.86";

export const GATEWAY_MANIFEST: GatewayManifest = {
  version: VERSION,
  artifacts: {
    "linux-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_linux_amd64.tar.gz`,
      "f1827a374e07c30cb41754a16351f15323e94e030fa2fcec271dc6d717528044",
      "tar.gz",
      "cli-proxy-api",
    ),
    "linux-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_linux_aarch64.tar.gz`,
      "2bae5b54bf84ac18131234ebc8242ea796944ac412e54edccc1984b2db3bdeaf",
      "tar.gz",
      "cli-proxy-api",
    ),
    "darwin-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_darwin_amd64.tar.gz`,
      "3712d64259c0e2023305665b52083b6dcf6956f44b51dd2a0626f5b538d5cb50",
      "tar.gz",
      "cli-proxy-api",
    ),
    "darwin-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_darwin_aarch64.tar.gz`,
      "1c8cc23e183a4f6a5095b77aa268dbe555e7268580c7251031e8b5c16f1f7508",
      "tar.gz",
      "cli-proxy-api",
    ),
    "win32-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_windows_amd64.zip`,
      "4d7b9a62070f6c95f139dd2b41ef4cc4f44af9bb1a11897e928131ba42707e32",
      "zip",
      "cli-proxy-api.exe",
    ),
    "win32-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_windows_aarch64.zip`,
      "679059a673f2fcadda596eeb9e1b7dbab6bdde74a9aff291418c6f4012e74986",
      "zip",
      "cli-proxy-api.exe",
    ),
  },
};

export function selectArtifact(
  manifest: GatewayManifest,
  platform: string,
  arch: string,
): ArtifactSelection {
  const entry = manifest.artifacts[`${platform}-${arch}`];
  if (entry === undefined) {
    return {
      ok: false,
      error: `No pinned gateway artifact for ${platform}/${arch}. Supported: ${Object.keys(
        manifest.artifacts,
      ).join(", ")}.`,
    };
  }
  return { ok: true, artifact: entry };
}
