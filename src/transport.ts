import type { Plugin } from "@opencode/plugin/effect";
import { Message, type SystemPart } from "@opencode/ai";
import { Session } from "@opencode/schema/session";
import { Deferred, Effect } from "effect";
import { CacheGate, cacheKeys } from "./cache.ts";

// Model calls of UniiChat's own (compactions and /btw memory lookups) go through OpenCode, with the
// user's own providers and credentials. OpenCode lets a plugin set a request's system, messages and
// options only in a hook, so each call gets a throwaway child session: `session.generate` on it,
// UniiChat's `generate` hook swaps in the prepared request, and the session is removed after.

export interface Call {
  /** The chat's session; the throwaway session is its child, so it shares the chat's cache key. */
  parentID: string;
  model: { providerID: string; id: string; variant?: string };
  system: string;
  messages: readonly Message[];
  /** Tool names to keep, in this order, from what OpenCode offers the throwaway session. */
  tools: readonly string[];
  /** Generation settings (e.g. maxTokens) and provider options, as OpenCode's request options. */
  options: Record<string, unknown>;
  /** Succeeds when the provider's response headers arrive. */
  started?: Deferred.Deferred<void>;
}

/** The fields of OpenCode's `generate` hook event that a call replaces. */
export interface GenerateEvent {
  readonly sessionID: string;
  system: SystemPart[];
  messages: Message[];
  tools: Record<string, { description: string; input: unknown }>;
  options: Record<string, unknown>;
}

export const METADATA = { uniichat: "call" } as const;

export function make(ctx: Plugin.Context) {
  const cache = new CacheGate();
  const pending = new Map<string, Call>();
  // Every throwaway session ever made, so late events about one are never taken for a subagent's.
  const known = new Set<string>();

  const run = (call: Call) => Effect.scoped(Effect.gen(function* () {
    const session = yield* ctx.session.create({
      parentID: Session.ID.make(call.parentID),
      title: "UniiChat",
      model: call.model as never,
      metadata: { ...METADATA },
    });
    pending.set(session.id, call);
    known.add(session.id);
    yield* Effect.addFinalizer(() => Effect.gen(function* () {
      pending.delete(session.id);
      yield* ctx.session.remove({ sessionID: session.id }).pipe(Effect.ignore);
    }));
    const started = call.started ?? Deferred.makeUnsafe<void>();
    if (started) {
      // Only while this call runs, and only for its provider: OpenCode wraps every request to a
      // provider that has HTTP hooks.
      yield* ctx.session.hook("http.response", (event) =>
        event.sessionID === session.id && event.response.ok ? Deferred.succeed(started, undefined).pipe(Effect.asVoid) : Effect.void,
      { providerID: call.model.providerID });
    }
    const parts = call.messages.flatMap((message) => message.content.map((part) => ({ ...part, role: message.role })));
    const last = parts.slice(0, -1).findLastIndex((part) => "cache" in part && !!part.cache);
    const keys = cacheKeys([call.parentID, call.model, call.options, call.system, call.tools],
      parts.slice(0, last + 1).map((part) => {
        const { cache: _cache, ...content } = part as typeof part & { cache?: unknown };
        return JSON.stringify(content);
      }));
    const ttl = /openai/i.test(call.model.providerID) ? 1800000 : 300000;
    const result = yield* cache.run(keys, ttl, started, ctx.session.generate({ sessionID: session.id, prompt: "UniiChat" }));
    return result.text;
  }));

  /** Applies a pending call to its `generate` request; false if the session is not one of ours. */
  const apply = (event: GenerateEvent): boolean => {
    const call = pending.get(event.sessionID);
    if (!call) return false;
    event.system = [{ type: "text", text: call.system }];
    event.messages = [...call.messages];
    const offered = event.tools;
    event.tools = Object.fromEntries(call.tools.flatMap((name) => offered[name] ? [[name, offered[name]] as const] : []));
    for (const key of Object.keys(event.options)) delete event.options[key];
    Object.assign(event.options, call.options);
    return true;
  };

  return { run, apply, owns: (sessionID: string) => known.has(sessionID) };
}

export type Transport = ReturnType<typeof make>;

/** One user message of text parts, with cache marks where asked. */
export function userMessage(parts: ReadonlyArray<{ text: string; cache?: boolean }>) {
  return new Message({
    role: "user",
    content: parts.map((part) => ({ type: "text" as const, text: part.text, ...(part.cache ? { cache: { type: "ephemeral" as const } } : {}) })),
  });
}

export function textMessage(role: "user" | "assistant", parts: ReadonlyArray<{ text: string; cache?: boolean }>) {
  return role === "user" ? userMessage(parts) : new Message({ role, content: parts.map((part) => ({ type: "text" as const, text: part.text })) });
}
