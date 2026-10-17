import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const scanner = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "secret-scan.mjs",
);

async function scanIn(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [scanner], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error: unknown) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

test("the gate secret scan flags new files by location without echoing the value", async () => {
  const repo = await mkdtemp(join(tmpdir(), "claudex-scan-"));
  await run("git", ["init", "--quiet"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  const token = `ghp_${"Z9".repeat(18)}`;
  // Untracked but not ignored: must be scanned before it is ever committed.
  await writeFile(join(repo, "leak.txt"), `first line\nvalue=${token}\n`);
  await writeFile(join(repo, "ignored.txt"), `${token}\n`);

  const result = await scanIn(repo);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /leak\.txt:2: GitHub token/);
  assert.doesNotMatch(result.stderr, /ignored\.txt/);
  assert.ok(!result.stderr.includes(token) && !result.stdout.includes(token));
});

test("the gate secret scan is silent on a clean checkout", async () => {
  const repo = await mkdtemp(join(tmpdir(), "claudex-scan-"));
  await run("git", ["init", "--quiet"], { cwd: repo });
  await writeFile(join(repo, "notes.txt"), "sk-short is not a key\n");

  const result = await scanIn(repo);
  assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
});
