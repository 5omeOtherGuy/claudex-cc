import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LoginDriver, LoginEvent, LoginMode } from "./orchestrator.js";

/** Minimal child surface for the spawned login process; satisfied by node:child_process. */
export interface LoginChild {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null) => void): this;
}

export type LoginSpawn = (binaryFile: string, args: readonly string[]) => LoginChild;

export interface CliproxyDriverOptions {
  readonly binaryFile: string;
  readonly configFile: string;
  readonly spawnFn?: LoginSpawn;
}

const defaultSpawn: LoginSpawn = (binaryFile, args) =>
  spawn(binaryFile, [...args], { stdio: ["ignore", "pipe", "pipe"] });

// Output contract of the pinned CLIProxyAPI release (sdk/auth/codex_device.go,
// sdk/auth/codex.go, internal/cmd/openai_*login.go at v7.2.86). The login
// process exits 0 even on failure, so only these lines decide the outcome.
const DEVICE_URL_LINE = /^Codex device URL: (\S+)/;
const DEVICE_CODE_LINE = /^Codex device code: (\S+)/;
const OPENING_BROWSER_LINE = "Opening browser for Codex authentication";
const VISIT_URL_LINE = "Visit the following URL to continue authentication:";
const SUCCESS_LINES = [
  "Codex authentication successful",
  "Codex device authentication successful!",
  "Codex authentication successful!",
];
const FAILURE_LINE =
  /^(?:Codex device authentication failed|Codex authentication failed|Authentication failed): (.*)$/;
// The "Authentication saved to <path>" line embeds the account e-mail in the
// file name; it must never be forwarded into an event payload.
const SAVED_PATH_LINE = /^Authentication saved to /;

// The upstream device flow polls for at most 15 minutes.
const DEVICE_FLOW_EXPIRY_SECONDS = 900;

function argsForMode(mode: LoginMode, configFile: string): readonly string[] {
  return mode === "device"
    ? ["--codex-device-login", "--no-browser", "--config", configFile]
    : ["--codex-login", "--config", configFile];
}

function hasStateParam(authorizationUrl: string): boolean {
  try {
    return (new URL(authorizationUrl).searchParams.get("state")?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Process-level login driver: spawns the pinned gateway binary in its login
 * mode and translates its terminal output into typed login events. Credential
 * persistence and validation stay with the orchestrator's validator.
 */
export function createCliproxyLoginDriver(options: CliproxyDriverOptions): LoginDriver {
  const spawnFn = options.spawnFn ?? defaultSpawn;
  return {
    async *start({ mode, signal }): AsyncGenerator<LoginEvent> {
      const child = spawnFn(options.binaryFile, argsForMode(mode, options.configFile));

      const queue: LoginEvent[] = [];
      let exited = false;
      let terminalEmitted = false;
      let browserPromptEmitted = false;
      let notify: (() => void) | undefined;
      const wake = (): void => {
        notify?.();
        notify = undefined;
      };

      let deviceUrl: string | undefined;
      let expectAuthUrl = false;
      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || SAVED_PATH_LINE.test(trimmed)) {
          return;
        }
        const deviceUrlMatch = DEVICE_URL_LINE.exec(trimmed);
        if (deviceUrlMatch?.[1] !== undefined) {
          deviceUrl = deviceUrlMatch[1];
          return;
        }
        const deviceCodeMatch = DEVICE_CODE_LINE.exec(trimmed);
        if (deviceCodeMatch?.[1] !== undefined) {
          queue.push({
            kind: "device_prompt",
            userCode: deviceCodeMatch[1],
            verificationUrl: deviceUrl ?? "https://auth.openai.com/codex/device",
            expiresInSeconds: DEVICE_FLOW_EXPIRY_SECONDS,
          });
          wake();
          return;
        }
        if (trimmed === OPENING_BROWSER_LINE && !browserPromptEmitted) {
          browserPromptEmitted = true;
          queue.push({ kind: "browser_prompt" });
          wake();
          return;
        }
        if (trimmed === VISIT_URL_LINE) {
          expectAuthUrl = true;
          return;
        }
        if (expectAuthUrl && /^https?:\/\//.test(trimmed)) {
          expectAuthUrl = false;
          if (!hasStateParam(trimmed)) {
            terminalEmitted = true;
            queue.push({
              kind: "failed",
              detail: "Browser authorization did not include OAuth state.",
            });
          } else if (!browserPromptEmitted) {
            browserPromptEmitted = true;
            queue.push({ kind: "browser_prompt" });
          }
          wake();
          return;
        }
        if (SUCCESS_LINES.includes(trimmed)) {
          if (!terminalEmitted) {
            terminalEmitted = true;
            if (mode === "browser") {
              // The pinned gateway emits success only after comparing the real
              // callback state with the state generated for this attempt.
              queue.push({ kind: "browser_callback_validated" });
            }
            queue.push({ kind: "persisted" });
            wake();
          }
          return;
        }
        const failure = FAILURE_LINE.exec(trimmed);
        if (failure !== null && !terminalEmitted) {
          terminalEmitted = true;
          const detail = failure[1] ?? "";
          queue.push(
            /access.?denied/i.test(detail)
              ? { kind: "denied", detail }
              : /state mismatch|state parameter is invalid/i.test(detail)
                ? { kind: "state_mismatch", detail }
                : { kind: "failed", detail },
          );
          wake();
        }
      };

      for (const stream of [child.stdout, child.stderr]) {
        if (stream !== null) {
          createInterface({ input: stream }).on("line", handleLine);
        }
      }

      const onAbort = (): void => {
        child.kill("SIGTERM");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("exit", () => {
        exited = true;
        wake();
      });

      try {
        while (true) {
          const event = queue.shift();
          if (event !== undefined) {
            yield event;
            continue;
          }
          if (exited) {
            return;
          }
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (!exited) {
          // The consumer stopped iterating (success, failure, or timeout);
          // never leave a login process polling in the background.
          child.kill("SIGTERM");
        }
      }
    },
  };
}
