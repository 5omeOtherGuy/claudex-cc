import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { validateConfig } from "../../src/config/schema.js";
import { saveConfig } from "../../src/config/store.js";
import type { Downloader } from "../../src/gateway/install.js";
import { installGatewayVersion } from "../../src/gateway/install.js";
import { GATEWAY_MANIFEST, selectArtifact } from "../../src/gateway/manifest.js";
import { renderSessionConfig } from "../../src/lifecycle/cliproxy.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";
import { ensureOwnerOnlyDir } from "../../src/security/permissions.js";
import { redactError, redactSecrets } from "../../src/security/redaction.js";

const run = promisify(execFile);
const POSIX = process.platform !== "win32";

async function makePaths(): Promise<ClaudexPaths> {
  const root = await mkdtemp(join(tmpdir(), "claudex-hard-"));
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

test("ensureOwnerOnlyDir tightens pre-existing loose directories", async (t) => {
  if (!POSIX) {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "claudex-perm-"));
  const dir = join(root, "loose");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o755);

  await ensureOwnerOnlyDir(dir);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
});

test("saving config into a pre-existing loose config dir tightens it", async (t) => {
  if (!POSIX) {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  const paths = await makePaths();
  await mkdir(paths.configDir, { recursive: true });
  await chmod(paths.configDir, 0o755);

  await saveConfig(paths, DEFAULT_CONFIG);
  assert.equal((await stat(paths.configDir)).mode & 0o777, 0o700);
  assert.equal((await stat(paths.configFile)).mode & 0o777, 0o600);
});

test("redaction covers headers, JWTs, client secrets, and query tokens", () => {
  const input = [
    "authorization: Bearer not-a-real-token",
    "Cookie: session=not-a-real-cookie",
    "x-api-key: not-a-real-key",
    "jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJlLXBhcnQ",
    '{"client_secret":"not-a-real-secret"}',
    "https://cb.invalid/x?client_secret=oops&api_key=oops2&token=oops3",
  ].join("\n");

  const result = redactSecrets(input);
  assert.doesNotMatch(
    result,
    /not-a-real-token|not-a-real-cookie|not-a-real-key|eyJhbGciOiJSUzI1NiJ9|not-a-real-secret|oops/,
  );
});

test("structured errors are redacted through the whole cause chain", () => {
  const inner = new Error('upstream said {"refresh_token":"fake-refresh-value"}');
  const outer = new Error("login failed: authorization: Bearer fake-bearer-value", {
    cause: inner,
  });

  const rendered = redactError(outer);
  assert.doesNotMatch(rendered, /fake-refresh-value|fake-bearer-value/);
  assert.match(rendered, /login failed/);
});

test("archives whose binary is a symlink are rejected", async (t) => {
  if (!POSIX) {
    t.skip("symlink fixtures require POSIX tar");
    return;
  }
  const fixtureRoot = await mkdtemp(join(tmpdir(), "claudex-evil-"));
  await symlink("/etc/hostname", join(fixtureRoot, "cli-proxy-api"));
  const archiveFile = join(fixtureRoot, "evil.tar.gz");
  await run("tar", ["-czf", archiveFile, "-C", fixtureRoot, "cli-proxy-api"]);
  const archiveBytes = await readFile(archiveFile);

  const paths = await makePaths();
  const downloader: Downloader = async ({ destination }) => {
    await writeFile(destination, archiveBytes);
  };
  const result = await installGatewayVersion({
    paths,
    manifest: {
      version: "1.2.3",
      artifacts: {
        "linux-x64": {
          assetName: "evil.tar.gz",
          url: "https://example.invalid/evil.tar.gz",
          sha256: createHash("sha256").update(archiveBytes).digest("hex"),
          archive: "tar.gz",
          binaryName: "cli-proxy-api",
        },
      },
    },
    platform: "linux",
    arch: "x64",
    downloader,
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /regular file|staging/i.test(result.error));
  await assert.rejects(stat(join(paths.dataDir, "gateway", "versions", "1.2.3")));
});

test("archives missing the expected binary fail closed", async () => {
  const paths = await makePaths();
  const bytes = Buffer.from("archive-without-binary");
  const result = await installGatewayVersion({
    paths,
    manifest: {
      version: "1.2.3",
      artifacts: {
        "linux-x64": {
          assetName: "gw.tar.gz",
          url: "https://example.invalid/gw.tar.gz",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          archive: "tar.gz",
          binaryName: "cli-proxy-api",
        },
      },
    },
    platform: "linux",
    arch: "x64",
    downloader: async ({ destination }) => {
      await writeFile(destination, bytes);
    },
    extractor: async () => {
      // Adversarial extractor that produces nothing inside the staging dir.
    },
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && /regular file/i.test(result.error));
});

test("the artifact allowlist rejects everything outside the pinned matrix", () => {
  for (const [platform, arch] of [
    ["linux", "mips"],
    ["android", "arm64"],
    ["linux-x64", ""],
    ["", ""],
  ] as const) {
    assert.equal(selectArtifact(GATEWAY_MANIFEST, platform, arch).ok, false);
  }
});

test("gateway session config cannot be rendered for non-loopback hosts or weak secrets", () => {
  const paths = {
    configDir: "/x",
    configFile: "/x/c",
    configBackupFile: "/x/b",
    dataDir: "/x/d",
    stateDir: "/x/s",
    credentialsDir: "/x/s/credentials",
  };
  const good = {
    binaryFile: "/x/bin",
    host: "127.0.0.1",
    port: 1,
    clientSecret: "a".repeat(48),
    paths,
  };
  assert.match(renderSessionConfig(good), /host: "127\.0\.0\.1"/);

  for (const host of ["0.0.0.0", "192.168.1.5", "example.com", "127.0.0.1 ", "localhost.evil"]) {
    assert.throws(() => renderSessionConfig({ ...good, host }), /loopback/i, host);
  }
  assert.throws(() => renderSessionConfig({ ...good, clientSecret: "short" }), /secret/i);
});

test("injection-shaped paths cannot be embedded into generated files", async () => {
  const { renderServiceUnit } = await import("../../src/lifecycle/systemd.js");
  const { renderShim } = await import("../../src/launcher/shim.js");

  for (const evil of [
    '/tmp/x"\nExecStart=/bin/evil',
    "/tmp/$(rm -rf ~)",
    "/tmp/%h/x",
    "/tmp/x`id`",
  ]) {
    assert.throws(
      () => renderServiceUnit({ binaryFile: evil, configFile: "/ok/c.yaml" }),
      /refusing/i,
    );
    assert.throws(() => renderShim("linux", evil), /refusing/i);
  }
  // Backslashes are path separators only on Windows embeddings.
  assert.throws(() => renderShim("linux", "/tmp/a\\b"), /backslash/i);
  assert.match(renderShim("win32", "C:\\Data Dir\\cli.js"), /C:\\Data Dir\\cli\.js/);

  const paths = {
    configDir: "/x",
    configFile: "/x/c",
    configBackupFile: "/x/b",
    dataDir: "/x/d",
    stateDir: "/x/s",
    credentialsDir: "/x/s'\ncredentials: evil",
  };
  assert.throws(
    () =>
      renderSessionConfig({
        binaryFile: "/x/bin",
        host: "127.0.0.1",
        port: 1,
        clientSecret: "a".repeat(48),
        paths,
      }),
    /refusing/i,
  );
});

test("spaced but benign paths still render into generated files", async () => {
  const { renderServiceUnit } = await import("../../src/lifecycle/systemd.js");
  const unit = renderServiceUnit({
    binaryFile: "/opt/my apps/cli-proxy-api",
    configFile: "/opt/my apps/gw.yaml",
  });
  assert.ok(
    unit.includes('ExecStart="/opt/my apps/cli-proxy-api" --config "/opt/my apps/gw.yaml"'),
  );

  const rendered = renderSessionConfig({
    binaryFile: "/x/bin",
    host: "127.0.0.1",
    port: 1,
    clientSecret: "a".repeat(48),
    paths: {
      configDir: "/x",
      configFile: "/x/c",
      configBackupFile: "/x/b",
      dataDir: "/x/d",
      stateDir: "/x/s",
      credentialsDir: "/Users/u/Library/Application Support/claudex/state/credentials",
    },
  });
  assert.match(rendered, /auth-dir: '\/Users\/u\/Library\/Application Support/);
});

test("a group-readable persistent secret is treated as compromised", async (t) => {
  if (!POSIX) {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  const { ensurePersistentSecret } = await import("../../src/launcher/launch.js");
  const paths = await makePaths();
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  const file = join(paths.stateDir, "persistent-secret");
  await writeFile(file, "b".repeat(48), { mode: 0o644 });

  await assert.rejects(ensurePersistentSecret(paths), /group- or world-accessible/i);
});

test("config validation rejects loopback lookalikes", () => {
  for (const host of ["127.0.0.1 ", " 127.0.0.1", "localhost.evil.com", "0x7f000001", "127.1"]) {
    const config = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
    (config.runtime as Record<string, unknown>).host = host;
    assert.equal(validateConfig(config).ok, false, `host "${host}" must be rejected`);
  }
});
