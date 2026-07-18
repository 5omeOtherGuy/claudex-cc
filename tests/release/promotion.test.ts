import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GATEWAY_MANIFEST } from "../../src/gateway/manifest.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Promotion rule: changing the pinned gateway release requires updating the
// public compatibility matrix and the changelog in the same change set. These
// tests fail any bump that skips either document.
test("the pinned gateway version is documented in the compatibility matrix", async () => {
  const matrix = await readFile(join(repoRoot, "docs", "compatibility-matrix.md"), "utf8");
  assert.ok(
    matrix.includes(GATEWAY_MANIFEST.version),
    `docs/compatibility-matrix.md must document gateway ${GATEWAY_MANIFEST.version}; update the matrix (and run the promotion gate) before bumping the manifest.`,
  );
});

test("the pinned gateway version is mentioned in the changelog", async () => {
  const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
  assert.ok(
    changelog.includes(GATEWAY_MANIFEST.version),
    `CHANGELOG.md must mention gateway ${GATEWAY_MANIFEST.version}; describe the promotion before bumping the manifest.`,
  );
});
