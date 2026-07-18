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
    pattern: /("(?:access_token|refresh_token|id_token|api_key|apiKey)"\s*:\s*")[^"]+(")/gi,
    replacement: "$1<REDACTED>$2",
  },
];

export function redactSecrets(value: string): string {
  return REDACTION_RULES.reduce(
    (redacted, rule) => redacted.replace(rule.pattern, rule.replacement),
    value,
  );
}
