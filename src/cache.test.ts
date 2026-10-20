import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { CacheGate, cacheKeys } from "./cache.ts";

const flush = Effect.gen(function* () { for (let i = 0; i < 20; i++) yield* Effect.yieldNow; });
test("cache identity includes model, options, system, tools and each prefix", () => {
  const id = { model: "haiku", options: { effort: "low" }, system: "rules", tools: [] };
  const a = cacheKeys(id, ["open", "four lines"]);
  expect(cacheKeys({ ...id, model: "other" }, ["open"])[0]).not.toBe(a[0]);
  expect(cacheKeys({ ...id, options: { effort: "high" } }, ["open"])[0]).not.toBe(a[0]);
  expect(cacheKeys({ ...id, system: "new rules" }, ["open"])[0]).not.toBe(a[0]);
  expect(cacheKeys({ ...id, tools: ["shell"] }, ["open"])[0]).not.toBe(a[0]);
  expect(cacheKeys({ tools: [], system: "rules", options: { effort: "low" }, model: "haiku" }, ["open", "four lines", "eight lines"]).slice(0, 2)).toEqual(a);
});

test("equal-prefix followers wait for headers, then all reuse the live entry; TTL expires", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    let now = 0, sent = 0;
    const gate = new CacheGate(() => now);
    const headers = Deferred.makeUnsafe<void>(), done = Deferred.makeUnsafe<void>();
    const work = Effect.sync(() => { sent++; }).pipe(Effect.andThen(Deferred.await(done)));
    const first = yield* gate.run(["prefix"], 100, headers, work).pipe(Effect.forkScoped);
    yield* flush;
    const second = yield* gate.run(["prefix"], 100, Deferred.makeUnsafe(), work).pipe(Effect.forkScoped);
    const third = yield* gate.run(["prefix"], 100, Deferred.makeUnsafe(), work).pipe(Effect.forkScoped);
    yield* flush;
    expect(sent).toBe(1);
    yield* Deferred.succeed(headers, undefined);
    yield* flush;
    expect(sent).toBe(3);
    yield* Deferred.succeed(done, undefined);
    yield* Fiber.joinAll([first, second, third]);
    now = 101;
    const pending = Deferred.makeUnsafe<void>();
    const leader = yield* gate.run(["prefix"], 100, Deferred.makeUnsafe(), Deferred.await(pending)).pipe(Effect.forkScoped);
    yield* flush;
    const follower = yield* gate.run(["prefix"], 100, Deferred.makeUnsafe(), Effect.sync(() => { sent++; })).pipe(Effect.forkScoped);
    yield* flush;
    expect(sent).toBe(3);
    yield* Fiber.interrupt(leader);
    yield* Fiber.join(follower);
    expect(sent).toBe(4);
  })));
});

test("longer prefixes wait on a shorter leader; failure releases them without warming cache", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const gate = new CacheGate();
    const fail = Deferred.makeUnsafe<void, string>();
    const first = yield* gate.run(["a"], 1000, Deferred.makeUnsafe(), Deferred.await(fail)).pipe(Effect.exit, Effect.forkScoped);
    yield* flush;
    let sent = false;
    const second = yield* gate.run(["a", "b"], 1000, Deferred.makeUnsafe(), Effect.sync(() => { sent = true; })).pipe(Effect.forkScoped);
    yield* flush;
    expect(sent).toBe(false);
    yield* Deferred.fail(fail, "no headers");
    yield* Fiber.joinAll([first, second]);
    expect(sent).toBe(true);
  })));
});
