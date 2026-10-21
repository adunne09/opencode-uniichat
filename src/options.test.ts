import { describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { COMPACTION } from "./chat.ts";
import { engineSettings, modelRef, parse } from "./options.ts";
import { lookupCalls, lookupResults } from "./prompts.ts";
import { QUEUE } from "./queue.ts";
import { make, type GenerateEvent } from "./transport.ts";
import { CHAT_BUDGET, COMPACTION_BUDGET } from "./view.ts";
import { generate } from "./compactor.ts";

describe("options", () => {
  test("rejects bad values with the option's path", () => {
    expect(() => parse({ compaction: { model: "haiku" } })).toThrow("compaction.model");
    expect(() => parse({ view: { chat: { high: 10, low: 20 } } })).toThrow("view.chat");
  });

  test("engine settings are per instance and source defaults stay immutable", () => {
    const settings = engineSettings(parse({ view: { chat: { high: 2000, low: 1000 } }, compaction: { timeoutMs: 1000, tries: 2, concurrency: 3 }, import: { leaves: 1 } }));
    expect(settings).toEqual({ chat: { high: 2000, low: 1000 }, compaction: COMPACTION_BUDGET, timeoutMs: 1000, tries: 2, concurrency: 3, importLeaves: 1 });
    settings.chat.high = 3000;
    expect(CHAT_BUDGET.high).toBe(128000);
    expect(COMPACTION.tries).toBe(5);
    expect(QUEUE.slots).toBe(64);
    expect(parse({}).compaction.maxTokens).toBe(128000);
  });

  test("modelRef splits at the first slash", () => {
    expect(modelRef("openrouter/anthropic/claude-haiku", "high")).toEqual({ providerID: "openrouter", id: "anthropic/claude-haiku", variant: "high" });
  });
});

describe("/btw lookup protocol", () => {
  test("reads one call per line and ignores everything else", () => {
    expect(lookupCalls("READY")).toEqual([]);
    expect(lookupCalls("zoom(40, 4)\n`date(12)`\nzoom(\"Explore\")\nzoom(7)\ndate(1, 2)\nsure: zoom(1, 2)")).toEqual([
      { name: "zoom", id: 40, n: 4, text: "zoom(40, 4)" },
      { name: "date", id: 12, text: "date(12)" },
      { name: "zoom", id: "Explore", text: "zoom(\"Explore\")" },
      { name: "zoom", id: 7, text: "zoom(7)" },
    ]);
    expect(lookupResults([{ call: "date(1)", text: "2026-10-17" }])).toStartWith("> date(1)\n2026-10-17\n\n[Reply");
  });
});

describe("transport", () => {
  test("the compactor strips every tool before reaching OpenCode", async () => {
    let names: readonly string[] | undefined;
    const transport: ReturnType<typeof make> = {
      run: (call) => Effect.sync(() => { names = call.tools; return " summary "; }), apply: () => false, owns: () => false,
    };
    const result = await Effect.runPromise(generate(transport, {
      parentID: "ses_chat", model: { providerID: "anthropic", id: "haiku" }, system: "rules",
      tools: [{ name: "bash", description: "shell", input: {} }], turns: [], options: { maxTokens: parse({}).compaction.maxTokens },
    }));
    expect(names).toEqual([]);
    expect(result.text).toBe("summary");
  });
  test("runs a call in a throwaway child session and swaps in its request", async () => {
    const created: unknown[] = [];
    const removed: string[] = [];
    const seen: GenerateEvent[] = [];
    let apply: ((event: GenerateEvent) => boolean) | undefined;
    const ctx = {
      session: {
        create: (input: unknown) => Effect.sync(() => { created.push(input); return { id: "ses_tmp" }; }),
        remove: ({ sessionID }: { sessionID: string }) => Effect.sync(() => { removed.push(sessionID); }),
        hook: (_name: string, callback: (event: unknown) => Effect.Effect<void>) => Effect.sync(() => { void callback; }),
        generate: ({ sessionID }: { sessionID: string }) => Effect.sync(() => {
          const event: GenerateEvent = {
            sessionID, system: [{ type: "text", text: "opencode" }], messages: [],
            tools: { read: { description: "read", input: {} }, zoom: { description: "zoom", input: {} }, bash: { description: "bash", input: {} } },
            options: { stray: 1 },
          };
          expect(apply!(event)).toBe(true);
          seen.push(event);
          return { text: " line " };
        }),
      },
    } as never;
    const transport = make(ctx);
    apply = transport.apply;
    const started = Deferred.makeUnsafe<void>();
    const text = await Effect.runPromise(transport.run({
      parentID: "ses_chat", model: { providerID: "anthropic", id: "claude-haiku-9" }, system: "unii",
      messages: [], tools: ["zoom", "read", "gone"], options: { maxTokens: 10 }, started,
    }));
    expect(text).toBe(" line ");
    expect(created).toEqual([expect.objectContaining({ parentID: "ses_chat", model: { providerID: "anthropic", id: "claude-haiku-9" } })]);
    expect(removed).toEqual(["ses_tmp"]);
    expect(seen[0]!.system).toEqual([{ type: "text", text: "unii" }]);
    expect(Object.keys(seen[0]!.tools)).toEqual(["zoom", "read"]);
    expect(seen[0]!.options).toEqual({ maxTokens: 10 });
    expect(transport.owns("ses_tmp")).toBe(true);
    expect(transport.apply({ ...seen[0]!, sessionID: "ses_other" })).toBe(false);
  });
});
