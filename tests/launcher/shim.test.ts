import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installShim, removeShim, renderShim, shimFileName } from "../../src/launcher/shim.js";

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
