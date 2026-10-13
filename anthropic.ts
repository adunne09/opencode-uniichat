import { AIClient, AIError, Message, ToolDefinition } from "@opencode/ai";
import * as LLM from "@opencode/ai/llm";
import { Anthropic } from "@opencode/ai/providers";
import { RequestExecutor } from "@opencode/ai/route";
import type { Service as LLMClientService } from "@opencode/ai/route/client";
import { Effect, Deferred, Layer } from "effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpBody from "effect/http/HttpBody";
import { buildRequestHeaders, rewriteRequestPayload } from "../../lib/anthropic-request.ts";

export type Input = {
  modelID: string;
  system: string;
  tools: ReadonlyArray<{ name: string; description: string; input: unknown }>;
  turns: ReadonlyArray<{
    role: "user" | "assistant";
    parts: ReadonlyArray<{ text: string; cache?: boolean }>;
  }>;
  token: Effect.Effect<string>;
  started?: Deferred.Deferred<void>;
};
export type Output = {
  text: string | undefined;
  usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
  ms: number;
};

type Cost = ReadonlyArray<{
  tier?: { type: "context"; size: number };
  input: number;
  output: number;
  cache: { read: number; write: number };
}>;

export function price(usage: Output["usage"], cost: Cost) {
  const context = usage.input + usage.cacheRead + usage.cacheWrite;
  const tier = cost
    .filter((item) => item.tier && item.tier.size < context)
    .sort((a, b) => b.tier!.size - a.tier!.size)[0]
    ?? cost.find((item) => !item.tier);
  if (!tier) {
    return 0;
  }
  return (
    usage.input * tier.input
    + (usage.output + usage.reasoning) * tier.output
    + usage.cacheRead * tier.cache.read
    + usage.cacheWrite * tier.cache.write
  ) / 1_000_000;
}

export function layer(executor: Layer.Layer<RequestExecutor.Service> = RequestExecutor.fetchLayer) {
  return AIClient.layerWith(RequestExecutor.middleware((request, next) => Effect.gen(function* () {
    const body = request.body;
    const text = body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : body._tag === "Raw" && typeof body.body === "string" ? body.body : "";
    const rewritten = rewriteRequestPayload(text);
    const sourceHeaders = new globalThis.Headers();
    for (const [key, value] of Object.entries(request.headers)) sourceHeaders.set(key, value);
    const headers = buildRequestHeaders(sourceHeaders, rewritten.modelId, sourceHeaders.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const updated = HttpClientRequest.setHeaders(
      HttpClientRequest.setBody(request, HttpBody.text(rewritten.body ?? text, "application/json")),
      Object.fromEntries(headers.entries()),
    );
    return yield* next(HttpClientRequest.removeHeader(updated, "x-api-key"));
  }), executor));
}

export const generate = Effect.fn("UniiChat.Anthropic.generate")(function* (input: Input): Effect.fn.Return<Output, AIError, LLMClientService> {
  const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const once = (token: string) => LLM.generate({
    model: Anthropic.model(input.modelID, { authToken: token }),
    system: [{ type: "text", text: input.system }],
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input as ToolDefinition["inputSchema"],
    })),
    messages: input.turns.map((turn) => new Message({
      role: turn.role,
      content: turn.parts.map((part) => ({ type: "text" as const, text: part.text, ...(part.cache ? { cache: { type: "ephemeral" as const } } : {}) })),
    })),
    providerOptions: { thinking: { type: "adaptive", display: "summarized" }, effort: "xhigh" },
    generation: { maxTokens: 32000 },
  }, {
    http: (request, next) => Effect.gen(function* () {
      const response = yield* next(request);
      if (input.started) yield* Deferred.succeed(input.started, undefined);
      return response;
    }),
  });
  const token = yield* input.token;
  const response = yield* once(token).pipe(Effect.catchReason("AI.Error", "Authentication", () => input.token.pipe(Effect.flatMap(once))));
  const usage = response.usage;
  const text = response.message.content.findLast((part) => part.type === "text");
  const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  return {
    text: text?.type === "text" ? text.text.trim() : undefined,
    usage: {
      input: usage?.nonCachedInputTokens ?? 0,
      output: usage?.outputTokens ?? 0,
      reasoning: usage?.reasoningTokens ?? 0,
      cacheRead: usage?.cacheReadInputTokens ?? 0,
      cacheWrite: usage?.cacheWriteInputTokens ?? 0,
    },
    ms: finishedAt - startedAt,
  };
}, (effect, input) => Effect.ensuring(
  effect,
  input.started ? Deferred.succeed(input.started, undefined) : Effect.void,
));

// One raw model call with a full message list, for the /btw memory lookup.
export const step = Effect.fn("UniiChat.Anthropic.step")(function* (input: {
  modelID: string;
  system: string;
  tools: ReadonlyArray<{ name: string; description: string; input: unknown }>;
  messages: ReadonlyArray<Message>;
  token: Effect.Effect<string>;
}): Effect.fn.Return<Message, AIError, LLMClientService> {
  const once = (token: string) => LLM.generate({
    model: Anthropic.model(input.modelID, { authToken: token }),
    system: [{ type: "text", text: input.system }],
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input as ToolDefinition["inputSchema"],
    })),
    messages: [...input.messages],
    generation: { maxTokens: 4000 },
  });
  const token = yield* input.token;
  const response = yield* once(token).pipe(Effect.catchReason("AI.Error", "Authentication", () => input.token.pipe(Effect.flatMap(once))));
  return response.message;
});
