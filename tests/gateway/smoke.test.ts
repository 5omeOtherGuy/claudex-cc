import assert from "node:assert/strict";
import test from "node:test";
import { runGatewaySmoke, type SmokeOptions } from "../../src/gateway/smoke.js";

const TARGET = { host: "127.0.0.1", port: 18999, clientSecret: "ab".repeat(24) };
const MODELS = { main: "gpt-main", subagent: "gpt-sub", fallback: "gpt-fall" };

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string;
}

function fakeFetch(
  handlers: Record<string, (init?: RequestInit) => Response>,
  requests: RecordedRequest[] = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = new URL(url).pathname;
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
    });
    const handler = handlers[path];
    if (handler === undefined) {
      return new Response("not found", { status: 404 });
    }
    return handler(init);
  }) as typeof fetch;
}

function inventoryResponse(ids: readonly string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function options(overrides?: Partial<SmokeOptions>): SmokeOptions {
  return { target: TARGET, models: MODELS, ...overrides };
}

test("a healthy staged gateway passes health, inventory, and token counting", async () => {
  const requests: RecordedRequest[] = [];
  const report = await runGatewaySmoke(
    options({
      fetchFn: fakeFetch(
        {
          "/v1/models": () => inventoryResponse(["gpt-main", "gpt-sub", "gpt-fall", "extra"]),
          "/v1/messages/count_tokens": () => new Response('{"input_tokens":3}', { status: 200 }),
        },
        requests,
      ),
    }),
  );

  assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  const byName = new Map(report.checks.map((check) => [check.name, check.status]));
  assert.equal(byName.get("health"), "pass");
  assert.equal(byName.get("model-inventory"), "pass");
  assert.equal(byName.get("token-count"), "pass");
  assert.equal(byName.get("stream"), "skip");
  assert.equal(byName.get("tools"), "skip");
  assert.ok(requests.every((request) => request.authorization.startsWith("Bearer ")));
});

test("a missing configured model fails the inventory gate and names it", async () => {
  const report = await runGatewaySmoke(
    options({
      fetchFn: fakeFetch({
        "/v1/models": () => inventoryResponse(["gpt-main", "gpt-fall"]),
        "/v1/messages/count_tokens": () => new Response("{}", { status: 200 }),
      }),
    }),
  );

  assert.equal(report.ok, false);
  const inventory = report.checks.find((check) => check.name === "model-inventory");
  assert.equal(inventory?.status, "fail");
  assert.match(inventory?.detail ?? "", /gpt-sub/);
});

test("an unimplemented count_tokens endpoint fails the gate", async () => {
  const report = await runGatewaySmoke(
    options({
      fetchFn: fakeFetch({
        "/v1/models": () => inventoryResponse(["gpt-main", "gpt-sub", "gpt-fall"]),
      }),
    }),
  );

  assert.equal(report.ok, false);
  const count = report.checks.find((check) => check.name === "token-count");
  assert.equal(count?.status, "fail");
  assert.match(count?.detail ?? "", /404/);
});

test("an unreachable gateway fails health without throwing", async () => {
  const report = await runGatewaySmoke(
    options({
      fetchFn: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    }),
  );

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.name === "health")?.status, "fail");
});

test("live inference consent runs bounded stream and tool smokes", async () => {
  const requests: RecordedRequest[] = [];
  const bodies: string[] = [];
  const report = await runGatewaySmoke(
    options({
      allowLiveInference: true,
      fetchFn: fakeFetch(
        {
          "/v1/models": () => inventoryResponse(["gpt-main", "gpt-sub", "gpt-fall"]),
          "/v1/messages/count_tokens": () => new Response("{}", { status: 200 }),
          "/v1/messages": (init) => {
            bodies.push(String(init?.body ?? ""));
            return new Response("event: message_start\n", { status: 200 });
          },
        },
        requests,
      ),
    }),
  );

  assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.checks.find((check) => check.name === "stream")?.status, "pass");
  assert.equal(report.checks.find((check) => check.name === "tools")?.status, "pass");
  for (const body of bodies) {
    assert.equal(
      (JSON.parse(body) as { max_tokens: number }).max_tokens,
      8,
      "token budget stays bounded",
    );
  }
});
