import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Git hooks export GIT_DIR and friends; without stripping them, git commands
// in the temporary repositories would act on the caller's repository.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const run = (file: string, args: readonly string[], options: { cwd: string }) =>
  execFileAsync(file, args, { ...options, env });
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

async function gitRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "claudex-scan-"));
  await run("git", ["init", "--quiet"], { cwd: repo });
  return repo;
}

// Every credential shape is assembled at runtime so this file stays clean.
const google = (suffix: string) => `${"AI"}za${"x".repeat(34)}${suffix}`;
const POSITIVE: ReadonlyArray<readonly [string, string]> = [
  ["private key", `-----BEGIN ${"RSA PRIVATE"} KEY-----`],
  ["GitHub token", `github_${"pat"}_${"a1".repeat(30)}`],
  ["OpenAI or Anthropic key", `"${"sk"}-ant-api03-${"q".repeat(24)}"`],
  ["AWS access key", `${"AK"}IA${"Q".repeat(16)}`],
  ["Google API key", `"${google("-")}"`],
  ["Google API key", `${google("_")} trailing`],
  ["Google API key", google("7")],
  ["Slack token", `${"xo"}xb-${"1".repeat(12)}`],
  ["npm token", `${"np"}m_${"b".repeat(36)}`],
  [
    "JSON Web Token",
    [`${"ey"}J${"h".repeat(12)}`, `${"ey"}J${"p".repeat(12)}`, "s".repeat(12)].join("."),
  ],
];
const NEGATIVE = [google("77"), `${"sk"}-short`, `${"AK"}IA${"q".repeat(16)}`, "BEGIN PUBLIC KEY"];

test("each scan rule flags its credential shape and ignores near-misses", async () => {
  const repo = await gitRepo();
  await writeFile(
    join(repo, "shapes.txt"),
    [...POSITIVE.map(([, value]) => value), ...NEGATIVE].join("\n"),
  );
  const result = await scanIn(repo);
  assert.equal(result.code, 1);
  const flagged = result.stderr.split("\n").filter((line) => line.startsWith("shapes.txt:"));
  assert.deepEqual(
    flagged,
    POSITIVE.map(([rule], index) => `shapes.txt:${index + 1}: ${rule}`),
  );
});

test("git failures fail the scan without echoing git's output", async () => {
  const repo = await gitRepo();
  const token = `ghp_${"Y8".repeat(18)}`;
  // Git rejects the invalid boolean and quotes the value in its error.
  await run("git", ["config", "core.bare", token], { cwd: repo });
  const result = await scanIn(repo);
  assert.equal(result.code, 2);
  assert.ok(!result.stderr.includes(token) && !result.stdout.includes(token));
});

test("unreadable files fail the scan closed", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async () => {
  const repo = await gitRepo();
  await writeFile(join(repo, "locked.txt"), "secret\n");
  await chmod(join(repo, "locked.txt"), 0o000);
  const result = await scanIn(repo);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /could not read locked\.txt \(EACCES\)/);
});

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
