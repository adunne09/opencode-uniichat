import { Cause, Data, Deferred, Effect, Exit, Semaphore } from "effect";
import * as anthropic from "./anthropic.ts";
import * as record from "./record.ts";
import * as tree from "./tree.ts";
import * as view from "./view.ts";
import * as prompts from "./prompts.ts";
import { WorkQueue, isPrefix } from "./queue.ts";
import { Store, chatDir, type Loaded, type StoreError } from "./store.ts";

export interface Item {
  kind: record.Kind;
  text: string;
  date: number;
  src: string;
  files?: readonly { name: string; mime: string; data?: Uint8Array }[];
}
export interface Deps {
  compact: (input: anthropic.Input) => Effect.Effect<anthropic.Output, unknown>;
  model: Effect.Effect<{ modelID: string; cost: Parameters<typeof anthropic.price>[1] }>;
  token: Effect.Effect<string>;
}
export class ChatError extends Data.TaggedError("ChatError")<{ message: string }> {}
export interface ToolResult {
  text: string;
  files?: { mime: string; data: Uint8Array }[];
}
type Usage = anthropic.Output["usage"] & { cost: number; ms: number };
const emptyUsage = (): Usage => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 0 });
const key = (ref: tree.Ref) => `${ref[0]}:${ref[1]}`;
function extension(mime: string): string {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  const known: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg", "text/plain": "txt", "text/markdown": "md", "audio/mpeg": "mp3", "application/octet-stream": "bin" };
  return known[type] ?? (type.split("/")[1]?.split("+").at(-1)?.replace(/[^a-z0-9]/g, "") || "bin");
}

export class Chat {
  private readonly mutex = Semaphore.makeUnsafe(1);
  private readonly records = new Map<number, record.LogRecord>();
  private readonly src = new Map<string, number>();
  private readonly agentSrc = new Map<string, Map<string, number>>();
  private readonly texts = new Map<string, string>();
  private readonly unpersisted = new Map<string, { ref: tree.Ref; text: string }>();
  private readonly agents: Map<string, record.LogRecord[]>;
  private readonly names = new Map<string, string>();
  private readonly queue: WorkQueue;
  private chat: view.View;
  private comp: view.View;
  private systemText: string | undefined;
  private tools: anthropic.Input["tools"] | undefined;
  private changed = Deferred.makeUnsafe<void>();
  private readonly writes = new Set<{ lines: string[]; started: Deferred.Deferred<void> }>();
  private last: Usage | undefined;
  private total = emptyUsage();
  private lastError: string | undefined;
  private T: number;
  private pending: number;
  private readonly lookup: view.Lookup = (l, i) => this.texts.get(key([l, i]));

  private constructor(private readonly store: Store, private readonly deps: Deps, loaded: Loaded) {
    for (const rec of loaded.records) {
      this.records.set(rec.i, rec);
      if (!this.src.has(rec.src)) this.src.set(rec.src, rec.i);
    }
    this.T = loaded.records.length ? loaded.records.at(-1)!.i + 1 : 0;
    for (const node of loaded.nodes) this.texts.set(key([node.l, node.i]), node.text);
    this.queue = WorkQueue.restore(this.T, loaded.nodes.map((node) => [node.l, node.i]));
    this.pending = this.T - new Set(loaded.nodes.filter((node) => node.l === 0).map((node) => node.i)).size;
    this.chat = view.createView(loaded.view ?? [], loaded.batch.chat, this.lookup);
    this.comp = view.createView(loaded.compView ?? [], loaded.batch.compaction, this.lookup);
    this.systemText = loaded.system;
    this.agents = loaded.agents;
    for (const [name, records] of this.agents) {
      this.agentSrc.set(name, new Map(records.map((rec) => [rec.src, rec.i])));
      const child = records[0]?.src.split(":")[0];
      if (child) this.names.set(child, name);
    }
  }

  static open = Effect.fn("Chat.open")(function* (dir: string, deps: Deps): Effect.fn.Return<Chat, StoreError> {
    const store = yield* Store.open(dir);
    const chat = new Chat(store, deps, yield* store.load());
    yield* chat.recoverViews();
    return chat;
  });

  private recoverViews() {
    const self = this;
    return Effect.gen(function* () {
      const end = (v: view.View) => v.lines.length ? tree.last(...v.lines.at(-1)!) + 1 : 0;
      const chatEnd = end(self.chat);
      const compEnd = end(self.comp);
      if (chatEnd === self.T && compEnd === self.T) return;
      // Replay only missing appends. Keep the saved prefix unchanged.
      if (chatEnd === compEnd) {
        for (let T = chatEnd + 1; T <= self.T; T++) view.step(self.chat, self.comp, T, self.lookup);
      } else {
        for (let T = chatEnd + 1; T <= self.T; T++) view.append(self.chat, T, self.lookup);
        for (let T = compEnd + 1; T <= self.T; T++) view.append(self.comp, T, self.lookup, view.COMPACTION_BUDGET);
      }
      yield* self.saveViews();
    });
  }

  private notify() {
    const old = this.changed;
    this.changed = Deferred.makeUnsafe<void>();
    return Deferred.succeed(old, undefined);
  }

  private refreshSizes() {
    this.chat = view.createView(this.chat.lines, this.chat.pending, this.lookup);
    this.comp = view.createView(this.comp.lines, this.comp.pending, this.lookup);
  }

  private saveViews() {
    return this.store.saveViews(view.serialize(this.chat), view.serialize(this.comp), { chat: this.chat.pending, compaction: this.comp.pending });
  }

  private pages(item: Item, src: ReadonlyMap<string, number>, filePrefix = "") {
    const self = this;
    return Effect.gen(function* () {
      const first = src.get(item.src) ?? src.get(`${item.src}:0`) ?? (filePrefix ? self.agents.get(filePrefix)!.length : self.T);
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

  log(items: readonly Item[]) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      for (const item of items) {
        if (item.kind === "echo" && self.src.has(item.src)) continue;
        const pages = yield* self.pages(item, self.src);
        for (const page of pages) {
          if (self.src.has(page.src)) continue;
          const rec = { ...page, i: self.T };
          yield* self.store.appendRecord(rec);
          self.records.set(rec.i, rec);
          self.src.set(rec.src, rec.i);
          self.T++;
          self.pending++;
          self.queue.append(self.T);
          view.step(self.chat, self.comp, self.T, self.lookup);
          yield* self.saveViews();
          self.queue.retryFailed();
          yield* self.pump();
        }
      }
    }).pipe(Effect.uninterruptible));
  }

  private persist(ref: tree.Ref, text: string) {
    const self = this;
    return Effect.gen(function* () {
      if (self.texts.has(key(ref))) return;
      text = self.unpersisted.get(key(ref))?.text ?? text;
      self.unpersisted.set(key(ref), { ref, text });
      yield* self.store.appendNode({ l: ref[0], i: ref[1], text, size: record.utf8Size(text) });
      self.texts.set(key(ref), text);
      self.unpersisted.delete(key(ref));
      if (ref[0] === 0) self.pending--;
    });
  }

  // The caller holds the mutex. Persist instant nodes before scheduling their parents.
  private pump(retryWrites = true): Effect.Effect<void, StoreError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.systemText === undefined || self.tools === undefined) return;
      if (retryWrites) {
        for (const { ref, text } of self.unpersisted.values()) {
          const saved = yield* self.persist(ref, text).pipe(Effect.exit);
          if (Exit.isSuccess(saved)) self.queue.built(ref);
          else self.lastError = Cause.pretty(saved.cause);
        }
        self.refreshSizes();
        yield* self.notify();
      }
      const starts: tree.Ref[] = [];
      while (true) {
        const work = self.queue.drain((ref) => {
          const rec = ref[0] === 0 ? self.records.get(ref[1])! : undefined;
          return rec ? tree.leafText(rec.kind, rec.text) : tree.mergeText(...tree.children(ref).map((child) => self.lookup(...child)!) as [string, string]);
        }, 8 - self.queue.inFlight.size);
        starts.push(...work.start);
        for (const [ref, text] of work.instant) self.unpersisted.set(key(ref), { ref, text });
        for (const [at, [ref, text]] of work.instant.entries()) {
          const saved = yield* self.persist(ref, text).pipe(Effect.exit);
          if (Exit.isFailure(saved)) {
            for (const [pending] of work.instant.slice(at)) self.queue.failed(pending);
            for (const pending of starts) self.queue.failed(pending);
            self.lastError = Cause.pretty(saved.cause);
            self.refreshSizes();
            yield* self.notify();
            return;
          }
          self.queue.built(ref);
        }
        if (!work.instant.length) break;
        self.refreshSizes();
        yield* self.notify();
      }
      for (const ref of starts) yield* Effect.forkDetach(self.build(ref));
    }).pipe(Effect.uninterruptible);
  }

  private task(ref: tree.Ref) {
    if (ref[0] === 0) {
      const rec = this.records.get(ref[1])!;
      return prompts.leafTask(rec.i, rec.kind, rec.text);
    }
    const [a, b] = tree.children(ref);
    return prompts.mergeTask(tree.name(...a), tree.name(...b), tree.first(...ref), tree.last(...ref), view.renderLine(a, this.lookup(...a)), view.renderLine(b, this.lookup(...b)));
  }

  private compact(ref: tree.Ref): Effect.Effect<string, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const model = yield* self.deps.model;
      const started = yield* Deferred.make<void>();
      let rendered: ReturnType<typeof view.blocks>;
      let registration: { lines: string[]; started: Deferred.Deferred<void> };
      while (true) {
        const lines = view.contextFor(self.comp, ref, self.lookup).map((r) => view.renderLine(r, self.lookup(...r)));
        rendered = view.blocks(lines);
        const markLines = lines.slice(0, rendered.blocks.length * 4);
        const blocker = [...self.writes].find((write) => !Deferred.isDoneUnsafe(write.started) && isPrefix(write.lines, markLines));
        if (blocker) {
          yield* Deferred.await(blocker.started);
          continue;
        }
        // Do not yield between the prefix check and registration.
        registration = { lines: markLines, started };
        self.writes.add(registration);
        break;
      }
      const system = self.systemText!;
      const tools = self.tools!;
      let turns: { role: "user" | "assistant"; parts: { text: string; cache?: boolean }[] }[] = [{ role: "user", parts: [
        ...rendered.blocks.map((text, i) => ({ text, ...(i === rendered.blocks.length - 1 ? { cache: true } : {}) })),
        { text: rendered.tail }, { text: self.task(ref), cache: true },
      ] }];
      return yield* Effect.gen(function* () {
        let shortest: string | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = yield* self.deps.compact({ modelID: model.modelID, system, tools, turns, token: self.deps.token, ...(attempt === 0 ? { started } : {}) }).pipe(Effect.exit);
          // Release the wait even when a test adapter or failed transport has no headers.
          if (attempt === 0) yield* Deferred.succeed(started, undefined);
          if (Exit.isFailure(result)) {
            if (shortest !== undefined) return shortest;
            return yield* Effect.failCause(result.cause);
          }
          const out = result.value;
          self.last = { ...out.usage, cost: anthropic.price(out.usage, model.cost), ms: out.ms };
          for (const field of Object.keys(self.total) as (keyof Usage)[]) self.total[field] += self.last[field];
          const line = out.text?.trim();
          if (line === undefined) {
            if (shortest !== undefined) return shortest;
            return yield* Effect.fail(new ChatError({ message: "Compaction returned no text" }));
          }
          if (shortest === undefined || record.utf8Size(line) < record.utf8Size(shortest)) shortest = line;
          if (record.utf8Size(line) <= 512) return line;
          if (attempt === 4) break;
          const previous = turns.at(-1)!;
          turns = [
            ...turns.slice(0, -1),
            { ...previous, parts: previous.parts.map((part, i) => i === previous.parts.length - 1 ? { text: part.text } : part) },
            { role: "assistant", parts: [{ text: line }] },
            { role: "user", parts: [{ text: prompts.tooLong(record.utf8Size(line), record.cutUtf8(line, 512)), cache: true }] },
          ];
        }
        return shortest!;
      }).pipe(Effect.ensuring(Effect.gen(function* () {
        self.writes.delete(registration);
        yield* Deferred.succeed(started, undefined);
      })));
    });
  }

  private build(ref: tree.Ref): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const retained = self.unpersisted.get(key(ref));
      const result = yield* (retained ? Effect.succeed(retained.text) : self.compact(ref)).pipe(Effect.exit);
      yield* self.mutex.withPermits(1)(Effect.gen(function* () {
        const saved = Exit.isSuccess(result) ? yield* self.persist(ref, result.value).pipe(Effect.exit) : result;
        if (Exit.isSuccess(saved)) {
          self.queue.built(ref);
          self.refreshSizes();
        } else {
          self.queue.failed(ref);
          self.lastError = Cause.pretty(saved.cause);
        }
        yield* self.notify();
        // Other ready work must not wait for a failed node's retry.
        yield* self.pump(false);
      }));
    }).pipe(Effect.catchCause((cause) => Effect.gen(function* () {
      self.lastError = Cause.pretty(cause);
      yield* self.notify();
    })), Effect.uninterruptible);
  }

  awaitSummarized() {
    const self = this;
    return Effect.gen(function* () {
      const T = self.T;
      let delay = 1000;
      yield* self.mutex.withPermits(1)(self.pump());
      while (!self.queue.waitDone(T)) {
        const next = self.changed;
        if (self.queue.failedNodes.size) {
          const until = (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + delay;
          while (!self.queue.waitDone(T) && self.queue.failedNodes.size) {
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

  renderView() {
    return view.blocks(this.chat.lines.map((ref) => view.renderLine(ref, this.lookup(...ref))));
  }

  zoom(id: number | string, n?: number): Effect.Effect<ToolResult, ChatError | StoreError> {
    const self = this;
    return Effect.gen(function* () {
      if (typeof id === "string") {
        const records = self.agents.get(id);
        if (!records) return yield* Effect.fail(new ChatError({ message: `Unknown agent: ${id}` }));
        return { text: records.map((rec) => `${rec.i}|${rec.kind}: ${rec.text}`).join("\n") };
      }
      const ref = n === undefined ? undefined : tree.parseZoom(n, id);
      if (!ref || tree.last(...ref) >= self.T) return yield* Effect.fail(new ChatError({ message: "zoom needs a valid id and power-of-two n inside the chat" }));
      if (n !== 1) return { text: tree.children(ref).map((child) => view.renderLine(child, self.lookup(...child))).join("\n") };
      const rec = self.records.get(id)!;
      const files: { mime: string; data: Uint8Array }[] = [];
      for (const match of rec.text.matchAll(/^\[file: .* (\S+) → (files\/[^\]\n]+)\]$/gm)) {
        files.push({ mime: match[1]!, data: yield* self.store.readFile(match[2]!) });
      }
      return { text: `${rec.kind}: ${rec.text}`, ...(files.length ? { files } : {}) };
    });
  }

  date(id: number): Effect.Effect<ToolResult, ChatError> {
    return Effect.suspend(() => {
      const rec = Number.isSafeInteger(id) ? this.records.get(id) : undefined;
      return rec ? Effect.succeed({ text: record.formatDate(new Date(rec.date).getTime()) }) : Effect.fail(new ChatError({ message: `Unknown message: ${id}` }));
    });
  }

  agentName(childSessionID: string, agentType: string): string {
    const existing = this.names.get(childSessionID);
    if (existing) return existing;
    const recovered = [...this.agents].find(([, records]) => records[0]?.src.startsWith(`${childSessionID}:`));
    const prefix = `${agentType}-`;
    let n = 1 + [...this.agents.keys()].filter((name) => name.startsWith(prefix)).length;
    while (this.agents.has(`${prefix}${n}`)) n++;
    const name = recovered?.[0] ?? `${prefix}${n}`;
    this.names.set(childSessionID, name);
    if (!this.agents.has(name)) {
      this.agents.set(name, []);
      this.agentSrc.set(name, new Map());
    }
    return name;
  }

  logAgent(name: string, items: readonly Item[]) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      if (!self.agents.has(name)) return yield* Effect.fail(new ChatError({ message: `Unknown agent: ${name}` }));
      const records = self.agents.get(name)!;
      const src = self.agentSrc.get(name)!;
      for (const item of items) {
        if (item.kind === "echo" && src.has(item.src)) continue;
        for (const page of yield* self.pages(item, src, name)) {
          if (src.has(page.src)) continue;
          const rec = { ...page, i: records.length };
          yield* self.store.appendAgent(name, rec);
          records.push(rec);
          src.set(rec.src, rec.i);
        }
      }
    }).pipe(Effect.uninterruptible));
  }

  setSystem(text: string) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      yield* self.store.saveSystem(text);
      self.systemText = text;
      yield* self.pump();
      yield* self.notify();
    }).pipe(Effect.uninterruptible));
  }

  system() { return this.systemText; }

  setTools(snapshot: anthropic.Input["tools"]) {
    const self = this;
    return this.mutex.withPermits(1)(Effect.gen(function* () {
      self.tools = structuredClone(snapshot);
      yield* self.pump();
      yield* self.notify();
    }).pipe(Effect.uninterruptible));
  }

  hasTools() { return this.tools !== undefined; }

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

const registry = new Map<string, Deferred.Deferred<Chat, StoreError>>();
export function get(sessionID: string, deps: Deps): Effect.Effect<Chat, StoreError> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    let loaded = registry.get(sessionID);
    if (!loaded) {
      loaded = Deferred.makeUnsafe<Chat, StoreError>();
      registry.set(sessionID, loaded);
      yield* Effect.forkDetach(Deferred.complete(loaded, Chat.open(chatDir(sessionID), deps)));
    }
    return yield* restore(Deferred.await(loaded));
  }));
}
