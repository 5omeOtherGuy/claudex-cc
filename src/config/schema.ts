import type { ClaudexConfig } from "./defaults.js";

export const CONFIG_VERSION = 1;

export interface ConfigValidationError {
  /** Dot-separated location of the offending value, or "" for the root. */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly config: ClaudexConfig }
  | { readonly ok: false; readonly errors: readonly ConfigValidationError[] };

// Config files must never carry credentials; matching keys are rejected outright.
// "token" alone is too broad (e.g. maxOutputTokens), so it only counts in
// credential-shaped combinations.
const SECRET_KEY_PATTERN =
  /(secret|password|credential|authorization|api[-_]?key|(?:access|refresh|id|auth|bearer|session)[-_]?token)/i;

const LOOPBACK_HOSTS = new Set(["localhost", "::1"]);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type FieldCheck = (value: unknown) => string | undefined;

function enumOf(...allowed: readonly string[]): FieldCheck {
  return (value) =>
    typeof value === "string" && allowed.includes(value)
      ? undefined
      : `must be one of: ${allowed.join(", ")}.`;
}

function positiveInteger(value: unknown): string | undefined {
  return Number.isInteger(value) && (value as number) > 0
    ? undefined
    : "must be a positive integer.";
}

const SCHEMA: Readonly<Record<string, Readonly<Record<string, FieldCheck>>>> = {
  runtime: {
    mode: enumOf("persistent", "session"),
    host: (value) =>
      typeof value === "string" && isLoopbackHost(value)
        ? undefined
        : 'must be a loopback address ("127.x.x.x", "::1", or "localhost"); remote exposure is not supported.',
    port: (value) =>
      Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65_535
        ? undefined
        : "must be an integer between 1 and 65535.",
  },
  gateway: {
    implementation: enumOf("cliproxyapi"),
    version: (value) =>
      typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value)
        ? undefined
        : 'must be a pinned semver version such as "7.2.86".',
    updateChannel: enumOf("pinned", "stable"),
  },
  models: {
    main: nonEmptyString,
    subagent: nonEmptyString,
    fallback: nonEmptyString,
  },
  reasoning: {
    effort: enumOf("low", "medium", "high", "xhigh", "max"),
  },
  context: {
    advertisedWindow: positiveInteger,
    compactAt: positiveInteger,
    maxOutputTokens: positiveInteger,
  },
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? undefined : "must be a non-empty string.";
}

function collectSecretKeyErrors(
  value: unknown,
  path: string,
  errors: ConfigValidationError[],
): void {
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      errors.push({
        path: childPath,
        message:
          "looks like a secret; credentials must never be stored in the config file. Remove it and use the login flow instead.",
      });
    }
    collectSecretKeyErrors(child, childPath, errors);
  }
}

export function validateConfig(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          message: "Config must be a JSON object. Run `config reset` to restore defaults.",
        },
      ],
    };
  }

  const errors: ConfigValidationError[] = [];
  collectSecretKeyErrors(value, "", errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (value.configVersion !== CONFIG_VERSION) {
    errors.push({
      path: "configVersion",
      message: `must be ${CONFIG_VERSION}. Older files are migrated automatically on load; newer files require a newer Claudex.`,
    });
  }

  for (const [section, fields] of Object.entries(SCHEMA)) {
    const sectionValue = value[section];
    if (!isRecord(sectionValue)) {
      errors.push({
        path: section,
        message: "section is missing or not an object. Run `config reset` to restore defaults.",
      });
      continue;
    }
    for (const [field, check] of Object.entries(fields)) {
      const problem = check(sectionValue[field]);
      if (problem !== undefined) {
        errors.push({ path: `${section}.${field}`, message: problem });
      }
    }
    for (const key of Object.keys(sectionValue)) {
      if (!(key in fields)) {
        errors.push({ path: `${section}.${key}`, message: "is not a recognized setting." });
      }
    }
  }

  for (const key of Object.keys(value)) {
    if (key !== "configVersion" && !(key in SCHEMA)) {
      errors.push({ path: key, message: "is not a recognized setting." });
    }
  }

  // Compaction must fire, and leave room for a full response, before the advertised window fills.
  const context = value.context;
  if (
    errors.length === 0 &&
    isRecord(context) &&
    typeof context.advertisedWindow === "number" &&
    typeof context.compactAt === "number" &&
    typeof context.maxOutputTokens === "number"
  ) {
    if (context.compactAt >= context.advertisedWindow) {
      errors.push({
        path: "context.compactAt",
        message: `must be below context.advertisedWindow (${context.advertisedWindow}) to reserve compaction headroom.`,
      });
    } else if (context.compactAt + context.maxOutputTokens >= context.advertisedWindow) {
      errors.push({
        path: "context.maxOutputTokens",
        message:
          "context.compactAt + context.maxOutputTokens must stay below context.advertisedWindow.",
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  // Safe: every schema field, the version, and the cross-field rules were checked above.
  return { ok: true, config: value as unknown as ClaudexConfig };
}
