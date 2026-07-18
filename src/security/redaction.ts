interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const REDACTION_RULES: readonly RedactionRule[] = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "<REDACTED>",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    replacement: "<REDACTED>",
  },
  {
    pattern: /([?&](?:code|state|access_token|refresh_token|id_token)=)[^&\s]+/gi,
    replacement: "$1<REDACTED>",
  },
  {
    pattern:
      /("(?:access_token|refresh_token|id_token|api_key|apiKey|client_secret|clientSecret)"\s*:\s*")[^"]+(")/gi,
    replacement: "$1<REDACTED>$2",
  },
  {
    // Credential-bearing HTTP headers in logged requests or errors.
    pattern:
      /\b((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*[:=]\s*)[^\r\n]+/gi,
    replacement: "$1<REDACTED>",
  },
  {
    // JWT-shaped tokens anywhere in free text.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "<REDACTED>",
  },
  {
    pattern: /([?&](?:client_secret|api_key|apikey|token)=)[^&\s]+/gi,
    replacement: "$1<REDACTED>",
  },
];

export function redactSecrets(value: string): string {
  return REDACTION_RULES.reduce(
    (redacted, rule) => redacted.replace(rule.pattern, rule.replacement),
    value,
  );
}

/**
 * Renders any thrown value as a redacted string, walking message, stack, and
 * the cause chain so structured errors cannot smuggle credentials into
 * diagnostics.
 */
export function redactError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 5) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      if (current.stack !== undefined && depth === 0) {
        parts.push(current.stack);
      }
      current = current.cause;
    } else {
      parts.push(typeof current === "string" ? current : JSON.stringify(current));
      current = undefined;
    }
    depth += 1;
  }
  return redactSecrets(parts.join("\n"));
}
