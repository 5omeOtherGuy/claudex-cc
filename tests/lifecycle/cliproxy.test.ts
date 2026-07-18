import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderSessionConfig, writeSessionConfig } from "../../src/lifecycle/cliproxy.js";
import type { LaunchRequest } from "../../src/lifecycle/session.js";
import type { ClaudexPaths } from "../../src/platform/paths.js";

async function makeRequest(): Promise<LaunchRequest & { paths: ClaudexPaths }> {
  const root = await mkdtemp(join(tmpdir(), "claudex-cpx-"));
  const configDir = join(root, "config");
  const stateDir = join(root, "state");
  return {
    binaryFile: "/fake/cli-proxy-api",
    host: "127.0.0.1",
    port: 8317,
    clientSecret: "a".repeat(48),
    paths: {
      configDir,
      configFile: join(configDir, "config.json"),
      configBackupFile: join(configDir, "config.json.bak"),
      dataDir: join(root, "data"),
      stateDir,
      credentialsDir: join(stateDir, "credentials"),
    },
  };
}

test("session config binds loopback, points at the credentials dir, and locks down management", async () => {
  const request = await makeRequest();
  const rendered = renderSessionConfig(request);

  assert.match(rendered, /host: "127\.0\.0\.1"/);
  assert.match(rendered, /port: 8317/);
  assert.ok(rendered.includes(`auth-dir: "${request.paths.credentialsDir}"`));
  assert.ok(rendered.includes(`- "${request.clientSecret}"`));
  assert.match(rendered, /allow-remote: false/);
  assert.match(rendered, /usage-statistics-enabled: false/);
});

test("the written session config is owner-only", async (t) => {
  const request = await makeRequest();
  const file = await writeSessionConfig(request);

  const content = await readFile(file, "utf8");
  assert.equal(content, renderSessionConfig(request));
  if (process.platform === "win32") {
    t.skip("POSIX permission bits are not meaningful on Windows");
    return;
  }
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
