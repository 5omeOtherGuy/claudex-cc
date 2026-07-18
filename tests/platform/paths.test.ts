import assert from "node:assert/strict";
import test from "node:test";
import { resolveClaudexPaths, resolveLauncherBinDir } from "../../src/platform/paths.js";

const HOME = "/home/user";

test("linux honors explicit XDG base directories", () => {
  const paths = resolveClaudexPaths({
    platform: "linux",
    homedir: HOME,
    env: {
      XDG_CONFIG_HOME: "/xdg/config",
      XDG_DATA_HOME: "/xdg/data",
      XDG_STATE_HOME: "/xdg/state",
    },
  });

  assert.equal(paths.configDir, "/xdg/config/claudex");
  assert.equal(paths.configFile, "/xdg/config/claudex/config.json");
  assert.equal(paths.configBackupFile, "/xdg/config/claudex/config.json.bak");
  assert.equal(paths.dataDir, "/xdg/data/claudex");
  assert.equal(paths.stateDir, "/xdg/state/claudex");
  assert.equal(paths.credentialsDir, "/xdg/state/claudex/credentials");
});

test("linux falls back to XDG defaults under the home directory", () => {
  const paths = resolveClaudexPaths({ platform: "linux", homedir: HOME, env: {} });

  assert.equal(paths.configDir, `${HOME}/.config/claudex`);
  assert.equal(paths.dataDir, `${HOME}/.local/share/claudex`);
  assert.equal(paths.stateDir, `${HOME}/.local/state/claudex`);
});

test("linux ignores relative XDG values as the spec requires", () => {
  const paths = resolveClaudexPaths({
    platform: "linux",
    homedir: HOME,
    env: { XDG_CONFIG_HOME: "relative/config" },
  });

  assert.equal(paths.configDir, `${HOME}/.config/claudex`);
});

test("macOS uses Application Support and Caches", () => {
  const paths = resolveClaudexPaths({ platform: "darwin", homedir: "/Users/u", env: {} });

  assert.equal(paths.configDir, "/Users/u/Library/Application Support/claudex");
  assert.equal(paths.dataDir, "/Users/u/Library/Application Support/claudex/data");
  assert.equal(paths.stateDir, "/Users/u/Library/Application Support/claudex/state");
  assert.equal(
    paths.credentialsDir,
    "/Users/u/Library/Application Support/claudex/state/credentials",
  );
});

test("windows uses APPDATA and LOCALAPPDATA", () => {
  const paths = resolveClaudexPaths({
    platform: "win32",
    homedir: "C:\\Users\\u",
    env: {
      APPDATA: "C:\\Users\\u\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
    },
  });

  assert.equal(paths.configDir, "C:\\Users\\u\\AppData\\Roaming\\claudex");
  assert.equal(paths.dataDir, "C:\\Users\\u\\AppData\\Local\\claudex\\data");
  assert.equal(paths.stateDir, "C:\\Users\\u\\AppData\\Local\\claudex\\state");
});

test("windows falls back to home-relative AppData when env vars are absent", () => {
  const paths = resolveClaudexPaths({ platform: "win32", homedir: "C:\\Users\\u", env: {} });

  assert.equal(paths.configDir, "C:\\Users\\u\\AppData\\Roaming\\claudex");
  assert.equal(paths.dataDir, "C:\\Users\\u\\AppData\\Local\\claudex\\data");
});

test("unsupported platforms fail closed", () => {
  assert.throws(
    () => resolveClaudexPaths({ platform: "sunos", homedir: HOME, env: {} }),
    /unsupported platform/i,
  );
});

test("the launcher directory is ~/.local/bin on POSIX platforms", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(
      resolveLauncherBinDir({ platform, homedir: HOME, env: {} }),
      "/home/user/.local/bin",
    );
  }
});

test("the windows launcher directory lives under LOCALAPPDATA", () => {
  assert.equal(
    resolveLauncherBinDir({
      platform: "win32",
      homedir: "C:\\Users\\u",
      env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
    }),
    "C:\\Users\\u\\AppData\\Local\\claudex\\bin",
  );
  assert.equal(
    resolveLauncherBinDir({ platform: "win32", homedir: "C:\\Users\\u", env: {} }),
    "C:\\Users\\u\\AppData\\Local\\claudex\\bin",
    "falls back to the home-relative AppData path",
  );
});
