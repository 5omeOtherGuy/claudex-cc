export type SmokeStatus = "pass" | "fail" | "skip";

export interface SmokeCheck {
  readonly name: string;
  readonly status: SmokeStatus;
  readonly detail: string;
}

export interface SmokeReport {
  /** True when every executed (non-skipped) check passed. */
  readonly ok: boolean;
  readonly checks: readonly SmokeCheck[];
}

export interface SmokeTarget {
  readonly host: string;
  readonly port: number;
  readonly clientSecret: string;
}

export interface SmokeOptions {
  readonly target: SmokeTarget;
  readonly models: {
    readonly main: string;
    readonly subagent: string;
    readonly fallback: string;
  };
  readonly fetchFn?: typeof fetch;
  /**
   * Streaming and tool smokes send one minimal billed request each; they run
   * only with explicit consent and are reported as skipped otherwise.
   */
  readonly allowLiveInference?: boolean;
  readonly timeoutMs?: number;
}

function baseUrl(target: SmokeTarget): string {
  return `http://${target.host}:${target.port}`;
}

function authHeaders(target: SmokeTarget): Record<string, string> {
  return { authorization: `Bearer ${target.clientSecret}`, "content-type": "application/json" };
}

/**
 * Candidate-gateway smoke suite (staged on a temporary endpoint before
 * activation). Health, model inventory, and token counting always run; the
 * billed streaming and tool checks are consent-gated. Details never include
 * response bodies — only statuses and model names from our own config.
 */
export async function runGatewaySmoke(options: SmokeOptions): Promise<SmokeReport> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const checks: SmokeCheck[] = [];
  const target = options.target;

  const request = async (path: string, init?: RequestInit): Promise<Response> =>
    fetchFn(`${baseUrl(target)}${path}`, {
      ...init,
      headers: { ...authHeaders(target), ...(init?.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    });

  let inventory: readonly string[] | undefined;
  try {
    const response = await request("/v1/models");
    if (response.ok) {
      checks.push({ name: "health", status: "pass", detail: "Authenticated /v1/models answered." });
      try {
        const parsed: unknown = await response.json();
        const data =
          typeof parsed === "object" && parsed !== null
            ? (parsed as { data?: unknown }).data
            : undefined;
        if (Array.isArray(data)) {
          inventory = data
            .map((entry) =>
              typeof entry === "object" && entry !== null
                ? (entry as { id?: unknown }).id
                : undefined,
            )
            .filter((id): id is string => typeof id === "string");
        }
      } catch {
        // A healthy endpoint with an unparseable body is caught below.
      }
    } else {
      checks.push({
        name: "health",
        status: "fail",
        detail: `Authenticated /v1/models returned HTTP ${response.status}.`,
      });
    }
  } catch (error: unknown) {
    checks.push({
      name: "health",
      status: "fail",
      detail: `Could not reach the staged gateway: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (inventory === undefined) {
    checks.push({
      name: "model-inventory",
      status: "fail",
      detail: "The staged gateway did not return a parseable model list.",
    });
  } else {
    const configured = [options.models.main, options.models.subagent, options.models.fallback];
    const missing = configured.filter((model) => !inventory.includes(model));
    checks.push(
      missing.length === 0
        ? {
            name: "model-inventory",
            status: "pass",
            detail: "All configured models are present in the staged inventory.",
          }
        : {
            name: "model-inventory",
            status: "fail",
            detail: `Configured model(s) missing from the staged inventory: ${missing.join(", ")}. A gateway without Codex credentials serves an empty Codex catalog — log in before updating.`,
          },
    );
  }

  try {
    const response = await request("/v1/messages/count_tokens", {
      method: "POST",
      body: JSON.stringify({
        model: options.models.main,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      }),
    });
    checks.push(
      response.ok
        ? { name: "token-count", status: "pass", detail: "count_tokens answered." }
        : {
            name: "token-count",
            status: "fail",
            detail: `count_tokens returned HTTP ${response.status}. Upstream-backed counting needs Codex credentials — log in before updating.`,
          },
    );
  } catch (error: unknown) {
    checks.push({
      name: "token-count",
      status: "fail",
      detail: `count_tokens failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (options.allowLiveInference === true) {
    try {
      const response = await request("/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: options.models.main,
          max_tokens: 8,
          stream: true,
          messages: [{ role: "user", content: [{ type: "text", text: "Reply with OK." }] }],
        }),
      });
      checks.push(
        response.ok
          ? { name: "stream", status: "pass", detail: "Streamed response started." }
          : {
              name: "stream",
              status: "fail",
              detail: `Streaming returned HTTP ${response.status}.`,
            },
      );
      await response.body?.cancel().catch(() => {});
    } catch (error: unknown) {
      checks.push({
        name: "stream",
        status: "fail",
        detail: `Streaming failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      const response = await request("/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: options.models.main,
          max_tokens: 8,
          messages: [{ role: "user", content: [{ type: "text", text: "What is the time?" }] }],
          tools: [
            {
              name: "get_time",
              description: "Returns the current time.",
              input_schema: { type: "object", properties: {}, additionalProperties: false },
            },
          ],
        }),
      });
      checks.push(
        response.ok
          ? {
              name: "tools",
              status: "pass",
              detail: "A tool-bearing request was accepted (tool selection is model behavior).",
            }
          : {
              name: "tools",
              status: "fail",
              detail: `Tool request returned HTTP ${response.status}.`,
            },
      );
    } catch (error: unknown) {
      checks.push({
        name: "tools",
        status: "fail",
        detail: `Tool request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    const detail =
      "Sends one minimal billed request; run update with --allow-live-inference to include it.";
    checks.push(
      { name: "stream", status: "skip", detail },
      { name: "tools", status: "skip", detail },
    );
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
