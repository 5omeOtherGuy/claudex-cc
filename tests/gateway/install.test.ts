import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Downloader, Extractor } from "../../src/gateway/install.js";
import { installGatewayVersion } from "../../src/gateway/install.js";
import type { GatewayManifest } from "../../src/gateway/manifest.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

const ARCHIVE_BYTES = Buffer.from("fake-gateway-archive");

function testManifest(overrides?: { url?: string; sha256?: string }): GatewayManifest {
  return {
    version: "1.2.3",
    artifacts: {
      "linux-x64": {
        assetName: "gw_linux_amd64.tar.gz",
        url: overrides?.url ?? "https://example.invalid/v1.2.3/gw_linux_amd64.tar.gz",
        sha256: overrides?.sha256 ?? createHash("sha256").update(ARCHIVE_BYTES).digest("hex"),
        archive: "tar.gz",
        binaryName: "cli-proxy-api",
      },
    },
  };
}

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-gw-"));
  const configDir = join(root, "config");
  const stateDir = join(root, "state");
  return {
    configDir,
    configFile: join(configDir, "config.json"),
    configBackupFile: join(configDir, "config.json.bak"),
    dataDir: join(root, "data"),
    stateDir,
    credentialsDir: join(stateDir, "credentials"),
  };
}

const fakeDownloader: Downloader = async ({ destination }) => {
  await writeFile(destination, ARCHIVE_BYTES);
};

const fakeExtractor: Extractor = async ({ archiveFile, targetDir }) => {
  const bytes = await readFile(archiveFile);
  await writeFile(join(targetDir, "cli-proxy-api"), bytes, { mode: 0o755 });
};

test("verified download installs the version side by side", async () => {
  const paths = await makePaths();
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest(),
    platform: "linux",
    arch: "x64",
    downloader: fakeDownloader,
    extractor: fakeExtractor,
  });

  assert.equal(result.ok, true);
  const binary = result.ok ? result.binaryFile : "";
  assert.match(binary, /versions[/\\]1\.2\.3[/\\]cli-proxy-api$/);
  await stat(binary);
});

test("two versions install next to each other", async () => {
  const paths = await makePaths();
  const first = await installGatewayVersion({
    paths,
    manifest: testManifest(),
    platform: "linux",
    arch: "x64",
    downloader: fakeDownloader,
    extractor: fakeExtractor,
  });
  const second = await installGatewayVersion({
    paths,
    manifest: { ...testManifest(), version: "1.2.4" },
    platform: "linux",
    arch: "x64",
    downloader: fakeDownloader,
    extractor: fakeExtractor,
  });

  assert.ok(first.ok && second.ok);
  const versions = await readdir(join(paths.dataDir, "gateway", "versions"));
  assert.deepEqual(versions.sort(), ["1.2.3", "1.2.4"]);
});

test("checksum mismatch fails closed and installs nothing", async () => {
  const paths = await makePaths();
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest({ sha256: "0".repeat(64) }),
    platform: "linux",
    arch: "x64",
    downloader: fakeDownloader,
    extractor: fakeExtractor,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /checksum/i.test(result.error));
  await assert.rejects(stat(join(paths.dataDir, "gateway", "versions", "1.2.3")));
});

test("interrupted download leaves no partial state behind", async () => {
  const paths = await makePaths();
  const interrupted: Downloader = async ({ destination }) => {
    await writeFile(destination, ARCHIVE_BYTES.subarray(0, 4));
    throw new Error("connection reset");
  };
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest(),
    platform: "linux",
    arch: "x64",
    downloader: interrupted,
    extractor: fakeExtractor,
  });

  assert.equal(result.ok, false);
  await assert.rejects(stat(join(paths.dataDir, "gateway", "versions", "1.2.3")));
  const downloads = await readdir(join(paths.dataDir, "gateway", "downloads")).catch(() => []);
  assert.deepEqual(downloads, []);
});

test("non-https manifest URLs are rejected before any download", async () => {
  const paths = await makePaths();
  let downloads = 0;
  const countingDownloader: Downloader = async (request) => {
    downloads += 1;
    await fakeDownloader(request);
  };
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest({ url: "http://example.invalid/gw_linux_amd64.tar.gz" }),
    platform: "linux",
    arch: "x64",
    downloader: countingDownloader,
    extractor: fakeExtractor,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /https/i.test(result.error));
  assert.equal(downloads, 0);
});

test("unsupported platforms execute nothing", async () => {
  const paths = await makePaths();
  let downloads = 0;
  const countingDownloader: Downloader = async (request) => {
    downloads += 1;
    await fakeDownloader(request);
  };
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest(),
    platform: "sunos",
    arch: "x64",
    downloader: countingDownloader,
    extractor: fakeExtractor,
  });

  assert.equal(result.ok, false);
  assert.equal(downloads, 0);
});

test("real tar extraction works end to end with the default extractor", async (t) => {
  if (process.platform === "win32") {
    t.skip("fixture archive is built with the POSIX tar CLI");
    return;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const fixtureRoot = await mkdtemp(join(tmpdir(), "claudex-fixture-"));
  await writeFile(join(fixtureRoot, "cli-proxy-api"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const archiveFile = join(fixtureRoot, "gw_linux_amd64.tar.gz");
  await run("tar", ["-czf", archiveFile, "-C", fixtureRoot, "cli-proxy-api"]);
  const archiveBytes = await readFile(archiveFile);

  const paths = await makePaths();
  const result = await installGatewayVersion({
    paths,
    manifest: testManifest({
      sha256: createHash("sha256").update(archiveBytes).digest("hex"),
    }),
    platform: "linux",
    arch: "x64",
    downloader: async ({ destination }) => {
      await writeFile(destination, archiveBytes);
    },
  });

  assert.equal(result.ok, true);
  const contents = await readFile(result.ok ? result.binaryFile : "", "utf8");
  assert.match(contents, /exit 0/);
});
