import { Deferred, Effect } from "effect";
import { textMessage, type Transport } from "./transport.ts";

export type Input = {
  system: string;
  tools: ReadonlyArray<{ name: string; description: string; input: unknown }>;
  turns: ReadonlyArray<{
    role: "user" | "assistant";
    parts: ReadonlyArray<{ text: string; cache?: boolean }>;
  }>;
  started?: Deferred.Deferred<void>;
};
export type Output = {
  text: string | undefined;
  ms: number;
};

export interface Model {
  providerID: string;
  id: string;
  variant?: string;
}

/** A compaction call through OpenCode's providers, in a throwaway child session of the chat's. */
export const generate = Effect.fn("UniiChat.compact")(function* (transport: Transport, input: Input & {
  parentID: string;
  model: Model;
  options: Record<string, unknown>;
}) {
  const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const text = yield* transport.run({
    parentID: input.parentID,
    model: input.model,
    system: input.system,
    messages: input.turns.map((turn) => textMessage(turn.role, turn.parts)),
    tools: [],
    options: input.options,
    ...(input.started ? { started: input.started } : {}),
  });
  const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const trimmed = text.trim();
  return { text: trimmed === "" ? undefined : trimmed, ms: finishedAt - startedAt } satisfies Output;
}, (effect, _transport, input) => Effect.ensuring(
  effect,
  input.started ? Deferred.succeed(input.started, undefined) : Effect.void,
));
