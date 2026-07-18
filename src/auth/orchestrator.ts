import type { ClaudexPaths } from "../platform/paths.js";
import { acquireLoginLock } from "./lock.js";

export type LoginMode = "device" | "browser";

export type LoginEvent =
  | {
      readonly kind: "device_prompt";
      readonly userCode: string;
      readonly verificationUrl: string;
      readonly expiresInSeconds: number;
    }
  | { readonly kind: "browser_prompt"; readonly authorizationUrl: string; readonly state: string }
  | { readonly kind: "callback"; readonly state: string }
  | { readonly kind: "persisted" }
  | { readonly kind: "denied"; readonly detail: string }
  | { readonly kind: "entitlement_error"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

export interface LoginDriver {
  start(options: {
    readonly mode: LoginMode;
    readonly signal: AbortSignal;
  }): AsyncIterable<LoginEvent>;
}

export interface AuthValidator {
  /** Confirms the gateway actually persisted an owner-only credential file. */
  checkPersisted(): Promise<{ readonly ok: boolean; readonly detail?: string }>;
  /** Makes one authenticated request through the gateway to prove the credential works. */
  probe(): Promise<
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly status: "unauthorized" | "entitlement" | "network";
        readonly detail: string;
      }
  >;
}

export type LoginFailureReason =
  | "locked"
  | "timeout"
  | "denied"
  | "state_mismatch"
  | "entitlement"
  | "persistence"
  | "validation"
  | "failed";

export type LoginResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: LoginFailureReason;
      readonly remediation: string;
      readonly detail?: string | undefined;
    };

export interface LoginOptions {
  readonly paths: ClaudexPaths;
  readonly driver: LoginDriver;
  readonly validator: AuthValidator;
  readonly mode?: LoginMode;
  readonly timeoutMs?: number;
  /** Receives short human-readable progress lines; never token material. */
  readonly onProgress?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const REMEDIATIONS: Readonly<Record<LoginFailureReason, string>> = {
  locked: "Wait for the active login attempt to finish or time out, then retry.",
  timeout: "The provider did not respond in time. Check connectivity and run login again.",
  denied: "The request was rejected on the provider side. Run login again and approve the request.",
  state_mismatch:
    "The callback did not match this login attempt. Run login again and only follow the newest link.",
  entitlement:
    "The account is authenticated but lacks Codex access. Check the subscription and retry.",
  persistence:
    "The provider approved the login but no owner-only credential file was persisted. Run doctor, then login again.",
  validation:
    "Credentials were stored but an authenticated request failed. Run login again to refresh them.",
  failed: "Login failed. Run doctor for diagnostics and retry.",
};

function failure(reason: LoginFailureReason, detail?: string): LoginResult {
  return { ok: false, reason, remediation: REMEDIATIONS[reason], detail };
}

export async function runLogin(options: LoginOptions): Promise<LoginResult> {
  const mode = options.mode ?? "device";
  const lock = await acquireLoginLock(options.paths.stateDir);
  if (!lock.ok) {
    return failure("locked", lock.error);
  }

  const progress = options.onProgress ?? (() => {});
  // A plain ref'ed timer instead of AbortSignal.timeout: the login must keep
  // the event loop alive while waiting on the provider (Node 22 unrefs the
  // AbortSignal.timeout timer, letting the process drain mid-login).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = controller.signal;

  try {
    let expectedState: string | undefined;
    let persisted = false;

    const iterate = async (): Promise<LoginResult | undefined> => {
      for await (const event of options.driver.start({ mode, signal })) {
        switch (event.kind) {
          case "device_prompt":
            progress(
              `To sign in, open ${event.verificationUrl} and enter the code ${event.userCode} (valid for ${event.expiresInSeconds}s).`,
            );
            break;
          case "browser_prompt":
            expectedState = event.state;
            progress("Complete the sign-in in the browser window that just opened.");
            break;
          case "callback":
            if (event.state !== expectedState) {
              return failure("state_mismatch");
            }
            progress("Callback received; finishing sign-in.");
            break;
          case "persisted":
            persisted = true;
            return undefined;
          case "denied":
            return failure("denied", event.detail);
          case "entitlement_error":
            return failure("entitlement", event.detail);
          case "failed":
            return failure("failed", event.detail);
        }
      }
      return persisted
        ? undefined
        : failure("failed", "login ended without persisting credentials");
    };

    let early: LoginResult | undefined;
    try {
      early = await iterate();
    } catch (error: unknown) {
      if (signal.aborted) {
        return failure("timeout");
      }
      throw error;
    }
    if (signal.aborted) {
      return failure("timeout");
    }
    if (early !== undefined) {
      return early;
    }

    // OAuth success is only claimed after persistence AND an authenticated
    // validation request (fail-closed rule from the security model).
    const persistedCheck = await options.validator.checkPersisted();
    if (!persistedCheck.ok) {
      return failure("persistence", persistedCheck.detail);
    }
    const probe = await options.validator.probe();
    if (!probe.ok) {
      return probe.status === "entitlement"
        ? failure("entitlement", probe.detail)
        : failure("validation", probe.detail);
    }
    progress("Login verified with an authenticated request.");
    return { ok: true };
  } finally {
    clearTimeout(timer);
    await lock.release();
  }
}
