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

// Hashes are transcribed from the upstream v8.0.32 checksums.txt release asset
// and additionally verified against all six downloaded archives.
const VERSION = "8.0.32";

export const GATEWAY_MANIFEST: GatewayManifest = {
  version: VERSION,
  artifacts: {
    "linux-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_linux_amd64.tar.gz`,
      "082a4a38d9470c070ac85ab2d9c4a2aa51f9a7ee19831c3b811e26fe5b7480a7",
      "tar.gz",
      "cli-proxy-api",
    ),
    "linux-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_linux_aarch64.tar.gz`,
      "76aac452dd224490ea5ea1ea0224199d7a410f14ef39a087b81893d15c62f363",
      "tar.gz",
      "cli-proxy-api",
    ),
    "darwin-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_darwin_amd64.tar.gz`,
      "c327f421d995692f6590a752abd449db5e71df61803b7041e4d3bd59cd1e1bd8",
      "tar.gz",
      "cli-proxy-api",
    ),
    "darwin-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_darwin_aarch64.tar.gz`,
      "48fe6a391a01e730ee6ebe3f1609ff92578a97a7a9a44579013ca8f3a6d58d51",
      "tar.gz",
      "cli-proxy-api",
    ),
    "win32-x64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_windows_amd64.zip`,
      "df364b1f2dc9fe357f6a481bfb8a4066c3e5f5ef4ad7abfe45e59b4cec547c18",
      "zip",
      "cli-proxy-api.exe",
    ),
    "win32-arm64": artifact(
      VERSION,
      `CLIProxyAPI_${VERSION}_windows_aarch64.zip`,
      "9e83b3f19f3359b52a1fe7acc763ed9285698a46d49caec650943d5b67e82010",
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
