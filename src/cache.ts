import { createHash } from "node:crypto";
import { Deferred, Effect, Exit } from "effect";

type Entry = { until: number; ready?: Deferred.Deferred<void> };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value;

/** Chained prefixes include the complete request identity, not just the chat text. */
export function cacheKeys(identity: unknown, blocks: readonly string[]) {
  let hash = createHash("sha256").update(JSON.stringify(stable(identity))).digest("hex");
  return blocks.map((text) => hash = createHash("sha256").update(hash).update(text).digest("hex"));
}

/** Source-style single flight: wait on the longest live prefix, reuse it until TTL.
 * Failed/cancelled leaders release followers without declaring their prefix cached.
 */
export class CacheGate {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now = Date.now, private readonly limit = 4096) {}
  run<A, E>(keys: readonly string[], ttl: number, started: Deferred.Deferred<void>, work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    const self = this;
    return Effect.scoped(Effect.gen(function* () {
      let owned: { key: string; entry: Entry; ready: Deferred.Deferred<void> } | undefined;
      while (keys.length) {
        const now = self.now();
        for (const [key, entry] of self.entries) if (!entry.ready && entry.until <= now) self.entries.delete(key);
        const index = keys.findLastIndex((key) => self.entries.has(key));
        const got = index < 0 ? undefined : self.entries.get(keys[index]!);
        if (got?.ready) { yield* Deferred.await(got.ready); continue; }
        if (got) {
          got.until = now + ttl;
          self.entries.delete(keys[index]!); self.entries.set(keys[index]!, got);
        }
        if (index === keys.length - 1) break;
        // Bound completed cache entries; active leaders are never evicted under waiters.
        for (const [key, entry] of self.entries) {
          if (self.entries.size < self.limit) break;
          if (!entry.ready) self.entries.delete(key);
        }
        const ready = Deferred.makeUnsafe<void>(), entry: Entry = { until: 0, ready };
        const key = keys.at(-1)!;
        self.entries.set(key, entry);
        owned = { key, entry, ready };
        break;
      }
      const begun = () => Effect.gen(function* () {
        if (!owned || !owned.entry.ready) return;
        owned.entry.until = self.now() + ttl;
        delete owned.entry.ready;
        yield* Deferred.succeed(owned.ready, undefined);
      });
      yield* Effect.addFinalizer(() => Effect.gen(function* () {
        if (!owned?.entry.ready) return;
        if (self.entries.get(owned.key) === owned.entry) self.entries.delete(owned.key);
        yield* Deferred.succeed(owned.ready, undefined);
      }));
      if (owned) yield* Deferred.await(started).pipe(Effect.flatMap(begun), Effect.forkScoped);
      return yield* work.pipe(Effect.onExit((exit) => Exit.isSuccess(exit) ? begun() : Effect.void));
    }));
  }
}
