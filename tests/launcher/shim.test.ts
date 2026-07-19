import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectShim,
  installShim,
  removeShim,
  renderShim,
  shimFileName,
} from "../../src/launcher/shim.js";

async function makeBinDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claudex-shim-"));
}

const ENTRY = "/data dir with spaces/manager/cli.js";

test("posix shim quotes the manager entry and forwards all arguments", () => {
  const shim = renderShim("linux", ENTRY);
  assert.match(shim, /^#!\/usr\/bin\/env bash/);
  assert.match(shim, /# Managed by Claudex/);
  assert.ok(shim.includes(`exec node "${ENTRY}" launch "$@"`));
});

test("windows shim uses cmd syntax with quoting and argument passthrough", () => {
  const shim = renderShim("win32", "C:\\Data Dir\\manager\\cli.js");
  assert.match(shim, /@echo off/);
  assert.match(shim, /rem Managed by Claudex/);
  assert.ok(shim.includes('node "C:\\Data Dir\\manager\\cli.js" launch %*'));
  assert.equal(shimFileName("win32"), "claudex.cmd");
  assert.equal(shimFileName("linux"), "claudex");
});

test("install writes an executable managed shim and reinstall is idempotent", async (t) => {
  const binDir = await makeBinDir();
  const first = await installShim({ binDir, platform: "linux", managerEntry: ENTRY });
  assert.equal(first.ok, true);

  const file = join(binDir, "claudex");
  assert.match(await readFile(file, "utf8"), /Managed by Claudex/);
  if (process.platform !== "win32") {
    assert.equal((await stat(file)).mode & 0o777, 0o755);
  } else {
    t.diagnostic("skipping mode assertion on Windows");
  }

  const second = await installShim({ binDir, platform: "linux", managerEntry: "/new/cli.js" });
  assert.equal(second.ok, true);
  assert.ok((await readFile(file, "utf8")).includes("/new/cli.js"));
});

test("an existing unmanaged claudex executable is never overwritten", async () => {
  const binDir = await makeBinDir();
  const file = join(binDir, "claudex");
  await writeFile(file, "#!/bin/sh\necho legacy launcher\n", { mode: 0o755 });

  const result = await installShim({ binDir, platform: "linux", managerEntry: ENTRY });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /not managed by claudex/i.test(result.error));
  assert.match(await readFile(file, "utf8"), /legacy launcher/);
});

test("a non-file launcher path is a preflight blocker", async () => {
  const binDir = await makeBinDir();
  await mkdir(join(binDir, "claudex"));

  const inspection = await inspectShim({ binDir, platform: "linux" });
  assert.equal(inspection.status, "blocked");
  assert.ok(inspection.status === "blocked" && /not a regular file/i.test(inspection.error));

  const install = await installShim({ binDir, platform: "linux", managerEntry: ENTRY });
  assert.equal(install.ok, false);
});

test("an unreadable launcher path is a preflight blocker", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("owner-mode readability is not deterministic on this host");
    return;
  }
  const binDir = await makeBinDir();
  const file = join(binDir, "claudex");
  await writeFile(file, "#!/bin/sh\necho blocked\n", { mode: 0o000 });

  const inspection = await inspectShim({ binDir, platform: "linux" });
  assert.equal(inspection.status, "blocked");
  assert.ok(inspection.status === "blocked" && /not readable/i.test(inspection.error));

  await chmod(file, 0o600);
});

test("remove deletes only managed shims and is idempotent", async () => {
  const binDir = await makeBinDir();
  await installShim({ binDir, platform: "linux", managerEntry: ENTRY });
  assert.equal((await removeShim({ binDir, platform: "linux" })).ok, true);
  await assert.rejects(stat(join(binDir, "claudex")));
  assert.equal((await removeShim({ binDir, platform: "linux" })).ok, true);

  const file = join(binDir, "claudex");
  await writeFile(file, "#!/bin/sh\necho legacy\n");
  const refused = await removeShim({ binDir, platform: "linux" });
  assert.equal(refused.ok, false);
  await stat(file);
});

test("windows shim uses CRLF line endings so cmd.exe parses it", () => {
  const shim = renderShim("win32", "C:\\Users\\u\\AppData\\Local\\claudex\\cli.js");
  assert.ok(shim.includes("\r\n"), "cmd scripts need CRLF");
  assert.ok(!shim.replaceAll("\r\n", "").includes("\r"), "no stray CR characters");
});

test("cmd expansion characters in the manager entry are refused", () => {
  // %VAR% expansion inside claudex.cmd would execute an attacker-influenced
  // path; the embeddable-path guard must reject it.
  assert.throws(() => renderShim("win32", "C:\\Data\\%EVIL%\\cli.js"), /refusing/i);
});
