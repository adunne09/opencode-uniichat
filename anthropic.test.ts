import { describe, expect, test } from "bun:test";
import { AIError, CacheHint, Message, TransportError } from "@opencode/ai";
import { RequestExecutor } from "@opencode/ai/route";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { generate, layer, price, type Input } from "./anthropic.ts";

function sse(texts: ReadonlyArray<string> = ["early text", "  final line\n"], thinking = true) {
  const events: Array<Record<string, unknown>> = [
    { type: "message_start", message: { usage: { input_tokens: 11, cache_read_input_tokens: 13, cache_creation_input_tokens: 17 } } },
  ];
  const blocks = [
    ...texts.map((text) => ({ type: "text", text })),
    ...(thinking ? [{ type: "thinking", thinking: "Ignore this reasoning.", signature: "sig" }] : []),
  ];
  blocks.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block });
    events.push({ type: "content_block_stop", index });
  });
  events.push(
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 19, output_tokens_details: { thinking_tokens: 3 } } },
    { type: "message_stop" },
  );
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function transport(handler: (request: Request) => Response) {
  const http = Layer.succeed(HttpClient.HttpClient, HttpClient.make((request) => Effect.gen(function* () {
    const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);
    return HttpClientResponse.fromWeb(request, handler(web));
  })));
  return layer(RequestExecutor.layer.pipe(Layer.provide(http)));
}

const input: Input = {
  modelID: "claude-haiku-5-5",
  system: "Compact the chat.",
  tools: [
    { name: "read", description: "Read a file", input: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    { name: "bash", description: "Run a command", input: { type: "object", properties: {} } },
  ],
  turns: [{ role: "user", parts: [{ text: "<chat>\n0|view", cache: true }, { text: "</chat>" }, { text: "Summarize.", cache: true }] }],
  token: Effect.succeed("access-token"),
};

describe("Anthropic compaction transport", () => {
  test("rewrites the lowered request and signals headers before reading the response", async () => {
    let captured: Request | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const client = transport((request) => {
      captured = request;
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const output = await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(generate({ ...input, started }).pipe(Effect.tap(() => Effect.sync(() => { finished = true; }))));
      yield* Deferred.await(started);
      expect(finished).toBe(false);
      expect(yield* Deferred.isDone(started)).toBe(true);
      controller!.enqueue(new TextEncoder().encode(sse()));
      controller!.close();
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(client)));

    const body = await captured!.json();
    expect(body.model).toBe(input.modelID);
    expect(body.system).toEqual([
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
    ]);
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(body.output_config).toEqual({ effort: "xhigh" });
    expect(body.max_tokens).toBe(32000);
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.tools).toEqual([
      { name: "Read", description: input.tools[0]!.description, input_schema: input.tools[0]!.input },
      { name: "Bash", description: input.tools[1]!.description, input_schema: input.tools[1]!.input, cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: [
      { type: "text", text: "<chat>\n0|view", cache_control: { type: "ephemeral" } },
      { type: "text", text: "</chat>" },
      { type: "text", text: "Summarize.", cache_control: { type: "ephemeral" } },
    ] }]);
    expect(JSON.stringify(body).match(/"cache_control"/g)).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain("1h");
    const headers = captured!.headers;
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("x-app")).toBe("cli");
    expect(headers.get("user-agent")).toBe(process.env.OPENCODE_ANTHROPIC_USER_AGENT || "claude-cli/2.1.280");
    expect(headers.get("anthropic-beta")?.split(",")).toEqual(expect.arrayContaining([
      "claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14",
    ]));
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(output.text).toBe("final line");
    expect(output.usage).toEqual({ input: 11, output: 19, reasoning: 3, cacheRead: 13, cacheWrite: 17 });
    expect(output.ms).toBeGreaterThanOrEqual(0);
  });

  test("resolves a new token and retries exactly once after a 401", async () => {
    let resolutions = 0;
    const tokens: Array<string | null> = [];
    const client = transport((request) => {
      tokens.push(request.headers.get("authorization"));
      return tokens.length === 1
        ? new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "Expired token" } }), { status: 401, headers: { "content-type": "application/json" } })
        : new Response(sse(), { headers: { "content-type": "text/event-stream" } });
    });
    const token = Effect.sync(() => `token-${++resolutions}`);
    const output = await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const output = yield* generate({ ...input, token, started });
      expect(yield* Deferred.isDone(started)).toBe(true);
      return output;
    }).pipe(Effect.provide(client)));
    expect(output.text).toBe("final line");
    expect(resolutions).toBe(2);
    expect(tokens).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  test("releases started on failure before headers and preserves the error", async () => {
    const failure = new AIError({ reason: new TransportError({ message: "Connection refused", transport: "http", operation: "request" }) });
    const client = layer(Layer.succeed(RequestExecutor.Service, { execute: () => Effect.fail(failure) }));
    await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const result = yield* generate({ ...input, started }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure).toBe(failure);
      expect(yield* Deferred.isDone(started)).toBe(true);
    }).pipe(Effect.provide(client)));
  });

  test("releases started when interrupted during token resolution", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const resolving = yield* Deferred.make<void>();
      const token = Deferred.succeed(resolving, undefined).pipe(Effect.andThen(Effect.never));
      const fiber = yield* Effect.forkChild(generate({ ...input, token, started }));
      yield* Deferred.await(resolving);
      yield* Fiber.interrupt(fiber);
      expect(yield* Deferred.isDone(started)).toBe(true);
    }).pipe(Effect.provide(transport(() => { throw new Error("Request must not start"); }))));
  });

  test("does not retry a second authentication failure", async () => {
    let calls = 0;
    let resolutions = 0;
    const client = transport(() => {
      calls++;
      return new Response('{"error":{"type":"authentication_error","message":"Invalid token"}}', { status: 401 });
    });
    const result = await Effect.runPromise(generate({ ...input, token: Effect.sync(() => `token-${++resolutions}`) }).pipe(Effect.result, Effect.provide(client)));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason._tag).toBe("Authentication");
    expect(calls).toBe(2);
    expect(resolutions).toBe(2);
  });

  test("resolves credentials for every call and keeps started signals per call", async () => {
    let resolutions = 0;
    const tokens: Array<string | null> = [];
    const client = transport((request) => {
      tokens.push(request.headers.get("authorization"));
      return new Response(sse(), { headers: { "content-type": "text/event-stream" } });
    });
    await Effect.runPromise(Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      const second = yield* Deferred.make<void>();
      const token = Effect.sync(() => `token-${++resolutions}`);
      yield* generate({ ...input, token, started: first });
      expect(yield* Deferred.isDone(first)).toBe(true);
      expect(yield* Deferred.isDone(second)).toBe(false);
      yield* generate({ ...input, token, started: second });
      expect(yield* Deferred.isDone(second)).toBe(true);
    }).pipe(Effect.provide(client)));
    expect(tokens).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(resolutions).toBe(2);
  });

  test("does not refresh credentials on a non-authentication error", async () => {
    let calls = 0;
    let resolutions = 0;
    const client = transport(() => {
      calls++;
      return new Response('{"error":{"type":"invalid_request_error","message":"Bad request"}}', { status: 400 });
    });
    const result = await Effect.runPromise(generate({ ...input, token: Effect.sync(() => `token-${++resolutions}`) }).pipe(Effect.result, Effect.provide(client)));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason._tag).toBe("InvalidRequest");
    expect(calls).toBe(1);
    expect(resolutions).toBe(1);
  });

  test("returns undefined when the reply contains no text block", async () => {
    const output = await Effect.runPromise(generate(input).pipe(Effect.provide(transport(() => new Response(sse([]), { headers: { "content-type": "text/event-stream" } })))));
    expect(output.text).toBeUndefined();
  });

  test("coerces plain ephemeral hints into CacheHint instances", () => {
    const message = new Message({ role: "user", content: [{ type: "text", text: "cached", cache: { type: "ephemeral" } }] });
    const part = message.content[0];
    expect(part?.type).toBe("text");
    if (part?.type === "text") {
      expect(part.cache).toBeInstanceOf(CacheHint);
      expect(part.cache).toEqual(new CacheHint({ type: "ephemeral" }));
    }
  });

  test("prices each token category at the largest strictly exceeded context tier", () => {
    const cost = [
      { tier: { type: "context" as const, size: 200 }, input: 9, output: 10, cache: { read: 11, write: 12 } },
      { input: 1, output: 2, cache: { read: 3, write: 4 } },
      { tier: { type: "context" as const, size: 100 }, input: 5, output: 6, cache: { read: 7, write: 8 } },
    ];
    const usage = { input: 70, output: 2, reasoning: 3, cacheRead: 20, cacheWrite: 10 };
    expect(price(usage, cost)).toBe((70 + 5 * 2 + 20 * 3 + 10 * 4) / 1_000_000);
    expect(price({ ...usage, cacheWrite: 11 }, cost)).toBe((70 * 5 + 5 * 6 + 20 * 7 + 11 * 8) / 1_000_000);
    expect(price({ ...usage, cacheWrite: 110 }, cost)).toBe((70 * 5 + 5 * 6 + 20 * 7 + 110 * 8) / 1_000_000);
    expect(price({ ...usage, cacheWrite: 111 }, cost)).toBe((70 * 9 + 5 * 10 + 20 * 11 + 111 * 12) / 1_000_000);
    expect(price(usage, [])).toBe(0);
    expect(price(usage, [cost[0]!])).toBe(0);
    expect(cost.map((item) => item.tier?.size)).toEqual([200, undefined, 100]);
  });
});
