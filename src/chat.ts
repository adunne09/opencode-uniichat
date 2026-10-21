import { Cause, Data, Deferred, Effect, Exit, Fiber, Semaphore } from "effect";
import type * as compactor from "./compactor.ts";
import * as record from "./record.ts";
import * as tree from "./tree.ts";
import * as view from "./view.ts";
import * as prompts from "./prompts.ts";
import { WorkQueue } from "./queue.ts";
import { Store, chatDir, type ImportBatch, type StoreError } from "./store.ts";
import { Archive } from "./archive.ts";
import { DEFAULT_ENGINE, type EngineSettings } from "./settings.ts";

export interface Item {
  kind: record.Kind;
  text: string;
  date: number;
  src: string;
  files?: readonly { name: string; mime: string; data?: Uint8Array }[];
}
export interface Deps {
  compact: (input: compactor.Input) => Effect.Effect<compactor.Output, unknown>;
  settings?: EngineSettings;
}
export class ChatError extends Data.TaggedError("ChatError")<{ message: string }> {}
export interface ToolResult {
  text: string;
  files?: { mime: string; data: Uint8Array }[];
}
// OpenCode's generate API reports no token usage, so compaction calls are counted and timed only.
type Usage = { calls: number; ms: number };
const emptyUsage = (): Usage => ({ calls: 0, ms: 0 });
// A compaction call that hangs (no response, stalled stream) must not block awaitSummarized forever.
// `tries` bounds the recipe's "Too long" loop. Both are set from the plugin options.
export const COMPACTION = Object.freeze({ timeoutMs: DEFAULT_ENGINE.timeoutMs, tries: DEFAULT_ENGINE.tries });
const key = (ref: tree.Ref) => `${ref[0]}:${ref[1]}`;

/** How many nodes have their last message in [a, b): an import's, all built once it is done. */
export function importNodes(a: number, b: number) {
  let n = 0;
  for (let w = 1; w <= b; w *= 2) n += Math.max(0, Math.floor(b / w) - Math.ceil((a + 1) / w) + 1);
  return n;
}
function extension(mime: string): string {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  const known: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "text/plain": "txt", "text/markdown": "md", "audio/mpeg": "mp3", "application/octet-stream": "bin" };
  return known[type] ?? (type.split("/")[1]?.split("+").at(-1)?.replace(/[^a-z0-9]/g, "") || "bin");
}

export class Chat {
  private readonly mutex = Semaphore.makeUnsafe(1);
  private readonly archive: Archive;
  private readonly settings: EngineSettings;
  private readonly unpersisted = new Map<string, { ref: tree.Ref; text: string }>();
  private queue: WorkQueue;
  // Rewind points, one per epoch; a build started in an older epoch is dropped if it covers one.
  private readonly cuts: number[] = [];
  private chat: view.View;
  private comp: view.View;
  private systemText: string | undefined;
  private toolsReady = false;
  private changed = Deferred.makeUnsafe<void>();
  private readonly fibers = new Set<Fiber.Fiber<void>>();
  private closed = false;
  private last: { ms: number } | undefined;
  private total = emptyUsage();
  private lastError: string | undefined;
  private T: number;
  private pending: number;
  private snapshot: string | undefined;
  /** The import under way, as import.json keeps it (none: none). */
  private importing: ImportBatch | undefined;
  private readonly lookup: view.Lookup = (l, i) => this.unpersisted.has(key([l, i])) ? undefined : this.archive.node(l, i);

  private constructor(private readonly store: Store, private readonly deps: Deps, loaded: {
    archive: Archive; view?: tree.Ref[]; compView?: tree.Ref[]; batch: { chat: boolean; compaction: boolean }; system?: string;
  }) {
    this.archive = loaded.archive;
    this.settings = { ...DEFAULT_ENGINE, ...structuredClone(deps.settings ?? DEFAULT_ENGINE) };
    this.importing = store.loadImport();
    this.T = this.archive.count();
    this.queue = this.makeQueue();
    this.pending = this.archive.pending();
    this.chat = view.createView(view.restore(this.T, loaded.view, this.lookup), loaded.batch.chat, this.lookup);
    this.comp = view.createView(view.restore(this.queue.first, loaded.compView, this.lookup), loaded.batch.compaction, this.lookup);
    this.systemText = loaded.system;
  }

  private makeQueue() {
    const side = (i: number) => this.archive.record(i)?.imported ? 1 : 0;
    const queue = new WorkQueue(this.T, [], this.settings.concurrency, {
      has: (ref) => !this.unpersisted.has(key(ref)) && this.archive.has(ref),
      missing: (from, limit, s) => [...new Set([
        ...this.archive.missing(from, limit, s),
        ...[...this.unpersisted.values()].filter(({ ref }) => ref[0] === 0 && ref[1] >= from && (s === undefined || side(ref[1]) === s)).map(({ ref }) => ref[1]),
      ])].sort((a, b) => a - b).slice(0, limit),
      ready: (end, limit, s) => this.archive.ready(end, limit, s),
    }, this.settings.importLeaves);
    // An import's summaries build while it runs, unless paused (Memory.ts `hold`).
    queue.held[1] = this.importing === undefined || this.importing.paused;
    return queue;
  }

  static open = Effect.fn("Chat.open")(function* (dir: string, deps: Deps): Effect.fn.Return<Chat, StoreError> {
    const store = yield* Store.open(dir);
    return yield* Effect.gen(function* () {
      const chat = new Chat(store, deps, yield* store.indexed());
      yield* chat.recoverViews();
      return chat;
    }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) ? Effect.sync(() => store.close()) : Effect.void));
  });

  private recoverViews() {
    return this.maintain();
  }

  private notify() {
    const old = this.changed;
    this.changed = Deferred.makeUnsafe<void>();
    return Deferred.succeed(old, undefined);
  }

  private maintain(next = false) {
    view.step(this.chat, this.comp, this.T, this.lookup, this.queue.first, this.settings.chat, this.settings.compaction, next);
    return this.saveViews();
  }

  private saveViews() {
    const chat = view.serialize(this.chat), comp = view.serialize(this.comp);
    const batch = { chat: this.chat.pending, compaction: this.comp.pending };
    const snapshot = JSON.stringify([chat, comp, batch]);
    if (snapshot === this.snapshot) return Effect.void;
    return this.store.saveViews(chat, comp, batch).pipe(Effect.tap(() => Effect.sync(() => { this.snapshot = snapshot; })));
  }

  private pages(item: Item, filePrefix = "") {
    const self = this;
    return Effect.gen(function* () {
      const scope = filePrefix ? `agent:${filePrefix}` : "main";
      const first = self.archive.source(item.src, scope) ?? self.archive.source(`${item.src}:0`, scope) ?? self.archive.count(scope);
      let text = item.text;
      for (const [k, file] of (item.files ?? []).entries()) {
        let path: string | undefined;
        if (file.data !== undefined) {
          const name = `${filePrefix ? `${filePrefix}-` : ""}${first}-${k}.${extension(file.mime)}`;
          path = `files/${name}`;
          // A crash can leave a file before its first record is flushed.
          const existing = yield* self.store.readFile(path).pipe(Effect.exit);
          if (Exit.isFailure(existing)) {
            const error = Cause.findErrorOption(existing.cause);
            if (error._tag !== "Some" || (error.value.cause as NodeJS.ErrnoException)?.code !== "ENOENT") {
              return yield* Effect.failCause(existing.cause);
            }
            yield* self.store.saveFile(name, file.data);
          }
        }
        text += `\n${record.fileLine(file.name, file.mime, path)}`;
      }
      return (item.kind === "echo" ? [record.clipEcho(text)] : record.splitText(text)).map((text, k) => ({
        kind: item.kind, text, size: record.utf8Size(text), date: record.formatISODate(item.date),
        src: item.kind === "echo" ? item.src : `${item.src}:${k}`,
      }));
    });
  }

  log(items: readonly Item[]): Effect.Effect<void, ChatError | StoreError> {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (self.closed) return yield* Effect.fail(new ChatError({ message: "Chat closed" }));
      for (const item of items) {
        if (item.kind === "echo" && self.archive.source(item.src) !== undefined) continue;
        const pages = yield* self.pages(item);
        for (const page of pages) {
          if (self.archive.source(page.src) !== undefined) continue;
          const rec = { ...page, i: self.T };
          yield* self.store.appendRecord(rec);
          self.T++;
          self.pending++;
          self.queue.append(self.T);
          yield* self.maintain(true);
          self.queue.retryFailed();
          yield* self.pump();
        }
      }
    }).pipe(Effect.uninterruptible));
  }

  private persist(ref: tree.Ref, text: string) {
    const self = this;
    return Effect.gen(function* () {
      if (self.lookup(...ref) !== undefined) return;
      text = self.unpersisted.get(key(ref))?.text ?? text;
      self.unpersisted.set(key(ref), { ref, text });
      yield* self.store.appendNode({ l: ref[0], i: ref[1], text, size: record.utf8Size(text) });
      self.unpersisted.delete(key(ref));
      if (ref[0] === 0) self.pending--;
    });
  }

  // The caller holds the mutex. Persist instant nodes before scheduling their parents.
  private pump(retryWrites = true): Effect.Effect<void, StoreError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.closed || self.systemText === undefined) return;
      if (retryWrites) {
        for (const { ref, text } of self.unpersisted.values()) {
          const saved = yield* self.persist(ref, text).pipe(Effect.exit);
          if (Exit.isSuccess(saved)) self.queue.built(ref);
          else self.lastError = Cause.pretty(saved.cause);
        }
        yield* self.maintain();
        yield* self.notify();
      }
      const starts: tree.Ref[] = [];
      let built = false;
      while (true) {
        const work = self.queue.drain((ref) => {
          const rec = ref[0] === 0 ? self.archive.record(ref[1])! : undefined;
          return rec ? tree.leafText(record.shownKind(rec), rec.text) : tree.mergeText(...tree.children(ref).map((child) => self.lookup(...child)!) as [string, string]);
        }, Number.POSITIVE_INFINITY);
        starts.push(...work.start);
        for (const [ref, text] of work.instant) self.unpersisted.set(key(ref), { ref, text });
        for (const [at, [ref, text]] of work.instant.entries()) {
          const saved = yield* self.persist(ref, text).pipe(Effect.exit);
          if (Exit.isFailure(saved)) {
            for (const [pending] of work.instant.slice(at)) self.queue.failed(pending);
            for (const pending of starts) self.queue.failed(pending);
            self.lastError = Cause.pretty(saved.cause);
            yield* self.maintain();
            yield* self.notify();
            return;
          }
          self.queue.built(ref);
        }
        if (!work.instant.length) break;
        built = true;
      }
      // Fit once all instant nodes are in, as Memory.pump does: a batch may merge into them.
      if (built) {
        yield* self.maintain();
        yield* self.checkImport();
        yield* self.notify();
      }
      for (const ref of starts) {
        const fiber = yield* Effect.forkDetach(Effect.interruptible(self.build(ref)));
        self.fibers.add(fiber);
        fiber.addObserver(() => self.fibers.delete(fiber));
      }
    }).pipe(Effect.uninterruptible);
  }

  private task(ref: tree.Ref) {
    if (ref[0] === 0) {
      const rec = this.archive.record(ref[1])!;
      return prompts.leafTask(rec.i, record.shownKind(rec), rec.text);
    }
    const [a, b] = tree.children(ref);
    return prompts.mergeTask(tree.name(...a), tree.name(...b), tree.first(...ref), tree.last(...ref), view.flat(this.lookup(...a)!), view.flat(this.lookup(...b)!));
  }

  // A node's source as one line, cut to the node limit: the line of a compaction that returned none.
  private clippedSource(ref: tree.Ref) {
    const source = ref[0] === 0
      ? `${record.shownKind(this.archive.record(ref[1])!)}: ${this.archive.record(ref[1])!.text}`
      : tree.children(ref).map((child) => this.lookup(...child)!).join("\n");
    return record.cutUtf8(source.replace(/\s*(\r\n|\r|\n)\s*/g, " "), tree.NODE_LIMIT);
  }

  private compact(ref: tree.Ref): Effect.Effect<string, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const rendered = view.blocks(view.contextFor(self.comp, ref, self.lookup).map((r) => view.renderLine(r, self.lookup(...r))));
      const system = self.systemText!;
      const first: { role: "user"; parts: { text: string; cache?: boolean }[] } = { role: "user", parts: [
        ...rendered.blocks.map((text, i) => ({ text, ...(i === rendered.blocks.length - 1 ? { cache: true } : {}) })),
        { text: rendered.tail }, { text: self.task(ref) },
      ] };
      let turns: compactor.Input["turns"] = [first];
      return yield* Effect.gen(function* () {
        let shortest: string | undefined;
        for (let attempt = 0; attempt < self.settings.tries; attempt++) {
          const result = yield* self.deps.compact({ system, tools: [], turns }).pipe(
            Effect.timeoutOrElse({
              duration: self.settings.timeoutMs,
              orElse: () => Effect.fail(new ChatError({ message: `Compaction call timed out after ${self.settings.timeoutMs / 1000}s` })),
            }),
            Effect.exit,
          );
          if (Exit.isFailure(result)) {
            if (shortest !== undefined) return shortest;
            return yield* Effect.failCause(result.cause);
          }
          const out = result.value;
          self.last = { ms: out.ms };
          self.total.calls++;
          self.total.ms += out.ms;
          const line = out.text?.trim();
          if (line === undefined) {
            if (shortest !== undefined) return shortest;
            // The model answered with no line (a refusal, or thinking used the whole output limit).
            // Asking again fails alike, so the node becomes its source clipped and the chat goes on.
            yield* Effect.logWarning(`UniiChat compaction of ${tree.name(...ref)} returned no text; using its source clipped`);
            return self.clippedSource(ref);
          }
          if (shortest === undefined || record.utf8Size(line) < record.utf8Size(shortest)) shortest = line;
          if (record.utf8Size(line) <= 512) return line;
          if (attempt === self.settings.tries - 1) break;
          // A retry resends the first request plus a note on the last line only: never a try's words.
          turns = [{ role: "user", parts: [...first.parts, { text: prompts.tooLong(record.utf8Size(line), record.cutUtf8(line, 512)) }] }];
        }
        return shortest!;
      });
    });
  }

  private build(ref: tree.Ref): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const epoch = self.cuts.length;
      const retained = self.unpersisted.get(key(ref));
      const result = yield* (retained ? Effect.succeed(retained.text) : self.compact(ref)).pipe(Effect.exit);
      yield* self.mutex.withPermits(1)(Effect.gen(function* () {
        if (self.closed) return;
        if (self.cuts.slice(epoch).some((k) => tree.last(...ref) >= k)) {
          // The records this node summarized were undone while it was being built.
          yield* self.notify();
          return;
        }
        const saved = Exit.isSuccess(result) ? yield* self.persist(ref, result.value).pipe(Effect.exit) : result;
        if (Exit.isSuccess(saved)) {
          self.queue.built(ref);
          // A retried node succeeded: the error no longer describes the chat's state.
          if (self.queue.failedNodes.size === 0) self.lastError = undefined;
        } else {
          self.queue.failed(ref);
          self.lastError = Cause.pretty(saved.cause);
        }
        // Other ready work must not wait for a failed node's retry. As Memory.job: the instant
        // nodes it readies first, then the views fit.
        yield* self.pump(false);
        yield* self.maintain();
        yield* self.checkImport();
        yield* self.notify();
      }).pipe(Effect.uninterruptible));
    }).pipe(Effect.catchCause((cause) => Effect.gen(function* () {
      self.lastError = Cause.pretty(cause);
      yield* self.notify();
    })));
  }

  // The first record whose message is gone from the session after an undo (the log tail whose
  // sources are absent, after the last record still present); undefined if nothing was undone or
  // no record is present at all (e.g. the session context starts after a checkpoint).
  // Source base of the latest record, undefined for an empty log.
  // Imported records are no session's own messages, so an undo never looks at them.
  latestSource(): string | undefined {
    const i = this.archive.lastOwn();
    return i === undefined ? undefined : this.archive.record(i)!.src.split(":")[0]!;
  }

  undoneFrom(present: (base: string) => boolean): number | undefined {
    let next: number | undefined;
    for (let i = this.T - 1; i >= 0; i--) {
      const rec = this.archive.record(i)!;
      if (rec.imported) continue;
      if (present(rec.src.split(":")[0]!)) return next;
      next = i;
    }
    return undefined;
  }

  // Drop records [k, T) from the log, tree and views (OpenCode undo). Returns the dropped src bases.
  rewind(k: number) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (!Number.isSafeInteger(k) || k < 0 || k >= self.T) return [] as string[];
      // An undo never takes an import with it: the messages before it stay.
      if (self.archive.importedFrom(k)) {
        yield* Effect.logWarning(`UniiChat kept records from ${k} on: an import follows them`);
        return [] as string[];
      }
      const chat = view.cut(self.chat.lines, k);
      const comp = view.cut(self.comp.lines, k);
      const bases = new Set<string>();
      for (let i = k; i < self.T; i++) {
        const rec = self.archive.record(i)!;
        bases.add(rec.src.split(":")[0]!);
      }
      yield* self.store.rewind(k, chat, comp, { chat: false, compaction: false });
      self.snapshot = undefined;
      for (const [id, { ref }] of [...self.unpersisted]) if (tree.last(...ref) >= k) self.unpersisted.delete(id);
      self.cuts.push(k);
      self.T = k;
      self.queue = self.makeQueue();
      self.pending = self.archive.pending();
      self.chat = view.createView(chat, false, self.lookup);
      self.comp = view.createView(comp, false, self.lookup);
      yield* self.notify();
      return [...bases];
    }).pipe(Effect.uninterruptible));
  }

  awaitSummarized(): Effect.Effect<void, ChatError | StoreError> {
    const self = this;
    return Effect.gen(function* () {
      const T = self.T;
      let delay = 1000;
      yield* self.mutex.withPermits(1)(self.pump());
      while (!self.queue.waitDone(T)) {
        if (self.closed) return yield* Effect.fail(new ChatError({ message: "Chat closed while waiting for summaries" }));
        const next = self.changed;
        if (self.queue.failedNodes.size) {
          const until = (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + delay;
          while (!self.queue.waitDone(T) && self.queue.failedNodes.size) {
            if (self.closed) return yield* Effect.fail(new ChatError({ message: "Chat closed while waiting for summaries" }));
            const notification = self.changed;
            const remaining = until - (yield* Effect.clockWith((clock) => clock.currentTimeMillis));
            if (remaining <= 0) break;
            yield* Effect.raceFirst(Effect.sleep(remaining), Deferred.await(notification));
          }
          if (self.queue.waitDone(T)) return;
          if (!self.queue.failedNodes.size) continue;
          delay = Math.min(delay * 2, 30000);
          yield* self.mutex.withPermits(1)(Effect.gen(function* () {
            self.queue.retryFailed();
            yield* self.pump();
          }));
        } else {
          yield* Deferred.await(next);
        }
      }
    });
  }

  /** The view's lines built (Memory.view): an import's not summarized yet are not shown. */
  renderView() {
    return view.blocks(this.chat.lines.flatMap((ref) => {
      const text = this.lookup(...ref);
      return text === undefined ? [] : [view.renderLine(ref, text)];
    }));
  }

  zoom(id: number | string, n = 1, at = 0): Effect.Effect<ToolResult, ChatError | StoreError> {
    const self = this;
    return Effect.gen(function* () {
      if (typeof id === "string") {
        if (/^\d+$/.test(id)) return yield* self.zoom(Number(id), n, at);
        if (!self.archive.agentExists(id)) return yield* Effect.fail(new ChatError({ message: `Unknown agent: ${id}` }));
        if (!Number.isSafeInteger(at) || at < 0) return yield* Effect.fail(new ChatError({ message: "at must be a non-negative safe integer" }));
        return { text: self.archive.agentPage(id, at) };
      }
      const ref = n === undefined ? undefined : tree.parseZoom(n, id);
      if (!ref || tree.last(...ref) >= self.T) {
        const roots = tree.roots(self.T).map((root) => tree.name(...root)).join(", ");
        return yield* Effect.fail(new ChatError({ message: `No line ${id}+${n ?? "?"}: n is a power of 2, id a multiple of n, inside the chat. The tree's roots: ${roots || "none"}.` }));
      }
      if (n !== 1) return { text: tree.children(ref).map((child) => view.renderLine(child, self.lookup(...child))).join("\n") };
      if (!Number.isSafeInteger(at) || at < 0) return yield* Effect.fail(new ChatError({ message: "at must be a non-negative safe integer" }));
      const rec = self.archive.record(id)!;
      const files: { mime: string; data: Uint8Array }[] = [];
      for (const match of (at === 0 ? rec.text : "").matchAll(/^\[file: .* (\S+) → (files\/[^\]\n]+)\]$/gm)) {
        files.push({ mime: match[1]!, data: yield* self.store.readFile(match[2]!) });
      }
      return { text: `${id}+0|${record.shownKind(rec)}: ${record.page(rec.text, at)}`, ...(files.length ? { files } : {}) };
    });
  }

  date(id: number): Effect.Effect<ToolResult, ChatError> {
    return Effect.suspend(() => {
      const rec = Number.isSafeInteger(id) ? this.archive.record(id) : undefined;
      return rec ? Effect.succeed({ text: record.formatDate(new Date(rec.date).getTime()) }) : Effect.fail(new ChatError({ message: `Unknown message: ${id}` }));
    });
  }

  agentName(childSessionID: string, agentType: string): string {
    return this.archive.agentName(childSessionID, agentType);
  }

  logAgent(name: string, items: readonly Item[]) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (!self.archive.agentExists(name)) return yield* Effect.fail(new ChatError({ message: `Unknown agent: ${name}` }));
      const scope = `agent:${name}`;
      for (const item of items) {
        if (item.kind === "echo" && self.archive.source(item.src, scope) !== undefined) continue;
        for (const page of yield* self.pages(item, name)) {
          if (self.archive.source(page.src, scope) !== undefined) continue;
          const rec = { ...page, i: self.archive.count(scope) };
          yield* self.store.appendAgent(name, rec);
        }
      }
    }).pipe(Effect.uninterruptible));
  }

  setSystem(text: string) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (self.systemText !== text) yield* self.store.saveSystem(text);
      self.systemText = text;
      yield* self.pump();
      yield* self.notify();
    }).pipe(Effect.uninterruptible));
  }

  system() { return this.systemText; }

  setTools(snapshot: compactor.Input["tools"]) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      self.toolsReady = true;
      yield* self.pump();
      yield* self.notify();
    }).pipe(Effect.uninterruptible));
  }

  hasTools() { return this.toolsReady; }

  /**
   * An import (Server.ts Chat.ingest): past messages logged at the chat's end, flagged imported, as
   * one write, then summarized on their own side, which no turn waits on (Memory.settle). Refused
   * while another runs. A message logged before (by its src) is skipped, so importing again brings
   * only what is new. Files come without their data, as names.
   */
  logImport(items: readonly Item[]): Effect.Effect<{ logged: number; a: number; b: number }, ChatError | StoreError> {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (self.closed) return yield* Effect.fail(new ChatError({ message: "Chat closed" }));
      if (self.importing !== undefined) return yield* Effect.fail(new ChatError({ message: "An import is under way: import again once it ends." }));
      const a = self.T;
      const recs: record.LogRecord[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const bare = { ...item, files: item.files?.map(({ name, mime }) => ({ name, mime })) };
        for (const page of yield* self.pages(bare)) {
          if (seen.has(page.src) || self.archive.source(page.src) !== undefined) continue;
          seen.add(page.src);
          recs.push({ ...page, i: a + recs.length, imported: true });
        }
      }
      if (recs.length === 0) return { logged: 0, a, b: a };
      yield* self.store.appendRecords(recs);
      self.T += recs.length;
      self.pending += recs.length;
      self.queue.append(self.T);
      self.importing = { a, b: self.T, paused: false, said: recs.filter((rec) => rec.kind !== "note").length };
      yield* self.store.saveImport(self.importing);
      self.queue.held[1] = false;
      yield* self.maintain(true);
      yield* self.pump();
      yield* self.notify();
      return { logged: recs.length, a, b: self.T };
    }).pipe(Effect.uninterruptible));
  }

  /** How far the import running is: its nodes built of all it takes (none: no import runs). */
  importStatus() {
    if (this.importing === undefined) return undefined;
    const { a, b, paused, said } = this.importing;
    const unpersisted = [...this.unpersisted.values()].filter(({ ref }) => tree.last(...ref) >= a && tree.last(...ref) < b).length;
    return { a, b, said, paused, built: this.archive.builtIn(a, b) + unpersisted, total: importNodes(a, b), running: this.queue.running(1) };
  }

  /** An import paused (no summary of it starts; those running end) or resumed. */
  pauseImport(paused: boolean): Effect.Effect<void, ChatError | StoreError> {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (self.importing === undefined) return yield* Effect.fail(new ChatError({ message: "No import is running." }));
      self.importing = { ...self.importing, paused };
      yield* self.store.saveImport(self.importing);
      self.queue.held[1] = paused;
      yield* self.maintain();
      yield* self.pump();
      yield* self.notify();
    }).pipe(Effect.uninterruptible));
  }

  // An import whose nodes are all built is done (Server.ts Chat.digest): its file goes.
  private checkImport() {
    const self = this;
    return Effect.gen(function* () {
      const status = self.importStatus();
      if (status === undefined || status.built < status.total) return;
      self.importing = undefined;
      self.queue.held[1] = true;
      yield* self.store.saveImport(undefined);
      yield* self.maintain();
    });
  }
  hasSource(base: string) { return this.archive.hasBase(base); }
  /** The message a source was logged as (its first page); undefined if it never was. */
  recordIndex(src: string) { return this.archive.source(src); }
  retained() { return this.archive.stats(); }
  retry() {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      self.queue.retryFailed();
      yield* self.pump();
    }));
  }
  close() {
    const self = this;
    return Effect.gen(function* () {
      yield* self.mutex.withPermits(1)(Effect.gen(function* () {
        self.closed = true;
        yield* self.notify();
      }));
      yield* Fiber.interruptAll(self.fibers);
      self.store.close();
    });
  }

  status() {
    return {
      T: this.T, viewBytes: this.chat.size, compViewBytes: this.comp.size, lines: this.chat.lines.length,
      inFlight: this.queue.inFlight.size, pending: this.pending,
      failed: this.queue.failedNodes.size,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      ...(this.last === undefined ? {} : { last: { ...this.last } }), total: { ...this.total },
    };
  }
}

/** Plugin-owned registry: reload interrupts its calls and releases its indexes. */
export function registry() {
  const chats = new Map<string, Deferred.Deferred<Chat, StoreError>>();
  const get = (sessionID: string, deps: Deps): Effect.Effect<Chat, StoreError> => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    let loaded = chats.get(sessionID);
    if (!loaded) {
      loaded = Deferred.makeUnsafe<Chat, StoreError>();
      chats.set(sessionID, loaded);
      yield* Deferred.complete(loaded, Chat.open(chatDir(sessionID), deps));
    }
    return yield* restore(Deferred.await(loaded));
  }));
  const each = (f: (chat: Chat) => Effect.Effect<void, unknown>) => Effect.forEach(chats.values(), (loaded) => Deferred.await(loaded).pipe(Effect.flatMap(f), Effect.ignore), { discard: true });
  return { get, retry: () => each((chat) => chat.retry()), close: () => each((chat) => chat.close()).pipe(Effect.tap(() => Effect.sync(() => chats.clear()))) };
}
