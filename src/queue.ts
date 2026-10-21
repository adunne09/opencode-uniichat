import { children, last, parent, sibling, type Ref } from "./tree.ts";

const key = ([l, i]: Ref) => `${l}:${i}`;
export const endpoint = (ref: Ref) => ref[0] === 0 ? ref[1] : last(...ref) + 1;
export const compare = (a: Ref, b: Ref) => endpoint(a) - endpoint(b) || b[0] - a[0];
export const QUEUE = Object.freeze({ slots: 64 });

/**
 * Production uses the disk index; the default in-memory index is useful for simulations. A side is
 * Memory.ts's: 0 the chat's nodes, 1 an import's (a node's side is its last message's).
 */
export interface NodeIndex {
  has(ref: Ref): boolean;
  missing(from: number, limit: number, side?: number): number[];
  ready(end: number, limit: number, side?: number): Ref[];
}

/**
 * What builds next, per side, as Memory.starts picks it: of each side not held, the nodes ready up
 * to its `concurrency`-th leaf not built, in the order the messages came (merges first at a tie),
 * while `concurrency` run. An import's leaves may run fewer at once (`importLeaves`), so each sees
 * more of the import before it; its merges still run `concurrency` at once.
 */
export class WorkQueue {
  T: number;
  readonly inFlight = new Set<string>();
  readonly failedNodes = new Map<string, Ref>();
  /** Why each side is held: 0 the chat's, never; 1 an import's, while none runs or it is paused. */
  readonly held: [boolean, boolean] = [false, true];
  private readonly sides = new Map<string, number>();
  private readonly reserved = new Set<string>();
  private readonly fits = new Map<string, string | undefined>();
  private readonly local = new Set<string>();
  private readonly merges = new Map<string, Ref>();
  private readonly prefix: [number, number] = [0, 0];
  private readonly index: NodeIndex;

  constructor(T = 0, built: readonly Ref[] = [], readonly concurrency: number = QUEUE.slots, private readonly external?: NodeIndex, readonly importLeaves: number = concurrency) {
    this.T = T;
    built.forEach((ref) => this.local.add(key(ref)));
    this.index = external ?? {
      has: (ref) => this.local.has(key(ref)),
      missing: (from, limit, side = 0) => {
        const out: number[] = [];
        if (side !== 0) return out;
        for (let i = Math.max(from, this.prefix[0]); i < this.T && out.length < limit; i++) if (!this.local.has(key([0, i]))) out.push(i);
        return out;
      },
      ready: (end, limit, side = 0) => side !== 0 ? [] : [...this.merges.values()].filter((ref) => endpoint(ref) <= end).sort(compare).slice(0, limit),
    };
    for (const ref of built) this.offer(ref);
    this.advance();
  }
  static restore(T: number, built: readonly Ref[], concurrency: number = QUEUE.slots) { return new WorkQueue(T, built, concurrency); }
  private advance() {
    for (const side of [0, 1]) this.prefix[side] = this.index.missing(this.prefix[side]!, 1, side)[0] ?? this.T;
  }
  /** The first message not built of the sides that build (the compaction view's reach, Memory.fit). */
  get first() { return Math.min(this.T, ...[0, 1].filter((side) => !this.held[side]).map((side) => this.prefix[side]!)); }
  /** The first message not built of a side (Memory.first). */
  firstOf(side: number) { return this.prefix[side === 1 ? 1 : 0]; }
  append(T: number) {
    if (T < this.T) throw new RangeError("T cannot decrease");
    this.T = T;
    this.advance();
  }
  private offer(ref: Ref) {
    if (this.external) return;
    const up = parent(ref);
    if (last(...up) < this.T && this.index.has(sibling(ref)) && !this.index.has(up)) this.merges.set(key(up), up);
  }
  built(ref: Ref) {
    const id = key(ref);
    if (!this.external) this.local.add(id);
    this.inFlight.delete(id);
    this.sides.delete(id);
    this.reserved.delete(id);
    this.failedNodes.delete(id);
    this.fits.delete(id);
    this.merges.delete(id);
    this.offer(ref);
    this.advance();
  }
  failed(ref: Ref) {
    const id = key(ref);
    const running = this.inFlight.delete(id), instant = this.reserved.delete(id);
    this.sides.delete(id);
    if (running || instant) this.failedNodes.set(id, ref);
  }
  retryFailed() { this.failedNodes.clear(); }
  /** Whether the chat's messages before T are built (an import's need not be: Memory.settle). */
  waitDone(T: number) { return T <= this.prefix[0]; }
  /** How many of a side's nodes are being built. */
  running(side: number) { return [...this.sides.values()].filter((s) => s === side).length; }

  drain(fits: (ref: Ref) => string | undefined, freeSlots: number): { instant: [Ref, string][]; start: Ref[] } {
    const instant: [Ref, string][] = [], start: Ref[] = [];
    const active = new Set<string>();
    for (const side of [0, 1].filter((side) => !this.held[side])) {
      const leafLimit = side === 0 ? this.concurrency : this.importLeaves;
      const leaves = this.index.missing(this.prefix[side]!, leafLimit, side);
      const horizon = leaves.length === leafLimit ? leaves.at(-1)! : this.T;
      // Include reservations in the query allowance so they cannot hide runnable work.
      const merges = this.index.ready(horizon, this.concurrency + this.inFlight.size + this.failedNodes.size + this.reserved.size, side);
      const candidates: Ref[] = [...leaves.map((i): Ref => [0, i]), ...merges].sort(compare);
      candidates.forEach((ref) => active.add(key(ref)));
      let slots = Math.max(0, Math.min(Math.floor(freeSlots), this.concurrency - this.running(side)));
      for (const ref of candidates) {
        const id = key(ref);
        if (this.running(side) >= this.concurrency) break;
        if (this.index.has(ref) || this.inFlight.has(id) || this.failedNodes.has(id) || this.reserved.has(id)) continue;
        if (ref[0] > 0 && !children(ref).every((child) => this.index.has(child))) continue;
        if (!this.fits.has(id)) this.fits.set(id, fits(ref));
        const text = this.fits.get(id);
        if (text !== undefined) { this.reserved.add(id); instant.push([ref, text]); }
        else if (slots > 0) { this.inFlight.add(id); this.sides.set(id, side); start.push(ref); slots--; }
      }
    }
    for (const id of this.fits.keys()) if (!active.has(id)) this.fits.delete(id);
    return { instant, start };
  }
}

export const isPrefix = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((value, i) => value === b[i]);
