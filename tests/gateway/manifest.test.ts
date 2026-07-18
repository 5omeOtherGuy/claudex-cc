import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { GATEWAY_MANIFEST, selectArtifact } from "../../src/gateway/manifest.js";

test("manifest version matches the pinned default gateway version", () => {
  assert.equal(GATEWAY_MANIFEST.version, DEFAULT_CONFIG.gateway.version);
});

test("every artifact is pinned to an https URL and a SHA-256 hash", () => {
  for (const [key, artifact] of Object.entries(GATEWAY_MANIFEST.artifacts)) {
    assert.match(artifact.url, /^https:\/\//, `${key} must use TLS`);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `${key} must pin a SHA-256 hash`);
    assert.ok(
      artifact.url.endsWith(artifact.assetName),
      `${key} URL must reference its asset name`,
    );
    assert.ok(artifact.url.includes(GATEWAY_MANIFEST.version), `${key} must pin the version`);
  }
});

test("supported platform pairs resolve to their artifact", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["linux", "x64", "CLIProxyAPI_7.2.86_linux_amd64.tar.gz"],
    ["linux", "arm64", "CLIProxyAPI_7.2.86_linux_aarch64.tar.gz"],
    ["darwin", "x64", "CLIProxyAPI_7.2.86_darwin_amd64.tar.gz"],
    ["darwin", "arm64", "CLIProxyAPI_7.2.86_darwin_aarch64.tar.gz"],
    ["win32", "x64", "CLIProxyAPI_7.2.86_windows_amd64.zip"],
    ["win32", "arm64", "CLIProxyAPI_7.2.86_windows_aarch64.zip"],
  ];
  for (const [platform, arch, assetName] of cases) {
    const result = selectArtifact(GATEWAY_MANIFEST, platform, arch);
    assert.equal(result.ok, true, `${platform}/${arch} must be supported`);
    assert.equal(result.ok && result.artifact.assetName, assetName);
  }
});

test("windows artifacts point at the .exe binary", () => {
  const result = selectArtifact(GATEWAY_MANIFEST, "win32", "x64");
  assert.ok(result.ok && result.artifact.binaryName === "cli-proxy-api.exe");
});

test("unsupported platform pairs fail closed with an actionable error", () => {
  for (const [platform, arch] of [
    ["sunos", "x64"],
    ["linux", "ia32"],
    ["freebsd", "x64"],
  ] as const) {
    const result = selectArtifact(GATEWAY_MANIFEST, platform, arch);
    assert.equal(result.ok, false, `${platform}/${arch} must be unsupported`);
    assert.ok(!result.ok && result.error.includes(platform));
  }
});
