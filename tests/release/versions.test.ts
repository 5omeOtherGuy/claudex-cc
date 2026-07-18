import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../src/version.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("package.json, plugin.json, and src/version.ts agree on the version", async () => {
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const pluginJson = JSON.parse(
    await readFile(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { version: string };

  assert.equal(packageJson.version, VERSION);
  assert.equal(pluginJson.version, VERSION);
});
