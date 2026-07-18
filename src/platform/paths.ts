import { homedir as osHomedir } from "node:os";
import { posix, win32 } from "node:path";

export interface PlatformContext {
  readonly platform: string;
  readonly homedir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ClaudexPaths {
  /** Directory holding config.json; must stay owner-only. */
  readonly configDir: string;
  readonly configFile: string;
  readonly configBackupFile: string;
  /** Installed gateway artifacts and other durable data. */
  readonly dataDir: string;
  /** Runtime state: logs, pid files, session material. */
  readonly stateDir: string;
  /** Credential storage; never inside a project checkout. */
  readonly credentialsDir: string;
}

interface BaseDirs {
  readonly configBase: string;
  readonly dataBase: string;
  readonly stateBase: string;
  readonly join: (...segments: string[]) => string;
}

// The XDG spec requires ignoring relative base-directory values.
function xdgDir(env: PlatformContext["env"], name: string, fallback: string): string {
  const value = env[name];
  return value !== undefined && posix.isAbsolute(value) ? value : fallback;
}

function resolveBaseDirs(context: PlatformContext): BaseDirs {
  switch (context.platform) {
    case "linux": {
      const home = context.homedir;
      return {
        configBase: xdgDir(context.env, "XDG_CONFIG_HOME", posix.join(home, ".config")),
        dataBase: xdgDir(context.env, "XDG_DATA_HOME", posix.join(home, ".local", "share")),
        stateBase: xdgDir(context.env, "XDG_STATE_HOME", posix.join(home, ".local", "state")),
        join: posix.join,
      };
    }
    case "darwin": {
      const support = posix.join(context.homedir, "Library", "Application Support", "claudex");
      return {
        configBase: support,
        dataBase: posix.join(support, "data"),
        stateBase: posix.join(support, "state"),
        join: posix.join,
      };
    }
    case "win32": {
      const roaming = context.env.APPDATA ?? win32.join(context.homedir, "AppData", "Roaming");
      const local = context.env.LOCALAPPDATA ?? win32.join(context.homedir, "AppData", "Local");
      return {
        configBase: win32.join(roaming, "claudex"),
        dataBase: win32.join(local, "claudex", "data"),
        stateBase: win32.join(local, "claudex", "state"),
        join: win32.join,
      };
    }
    default:
      throw new Error(
        `Unsupported platform "${context.platform}": Claudex supports linux, darwin, and win32.`,
      );
  }
}

export function resolveClaudexPaths(context: PlatformContext): ClaudexPaths {
  const base = resolveBaseDirs(context);
  // linux appends the app segment to each XDG base; darwin/win32 bases already include it.
  const configDir =
    context.platform === "linux" ? base.join(base.configBase, "claudex") : base.configBase;
  const dataDir =
    context.platform === "linux" ? base.join(base.dataBase, "claudex") : base.dataBase;
  const stateDir =
    context.platform === "linux" ? base.join(base.stateBase, "claudex") : base.stateBase;

  return {
    configDir,
    configFile: base.join(configDir, "config.json"),
    configBackupFile: base.join(configDir, "config.json.bak"),
    dataDir,
    stateDir,
    credentialsDir: base.join(stateDir, "credentials"),
  };
}

export function resolveCurrentPlatformPaths(): ClaudexPaths {
  return resolveClaudexPaths({
    platform: process.platform,
    homedir: osHomedir(),
    env: process.env,
  });
}
