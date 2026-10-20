import { children, last, parent, sibling, type Ref } from "./tree.ts";

const key = ([l, i]: Ref) => `${l}:${i}`;
export const endpoint = (ref: Ref) => ref[0] === 0 ? ref[1] : last(...ref) + 1;
export const compare = (a: Ref, b: Ref) => endpoint(a) - endpoint(b) || b[0] - a[0];
export const QUEUE = Object.freeze({ slots: 64 });

/** Production uses the disk index; the default in-memory index is useful for simulations. */
export interface NodeIndex {
  has(ref: Ref): boolean;
  missing(from: number, limit: number): number[];
  ready(end: number, limit: number): Ref[];
}

export class WorkQueue {
  T: number;
  readonly inFlight = new Set<string>();
  readonly failedNodes = new Map<string, Ref>();
  private readonly reserved = new Set<string>();
  private readonly fits = new Map<string, string | undefined>();
  private readonly local = new Set<string>();
  private readonly merges = new Map<string, Ref>();
  private prefix = 0;
  private readonly index: NodeIndex;

  constructor(T = 0, built: readonly Ref[] = [], readonly concurrency: number = QUEUE.slots, private readonly external?: NodeIndex) {
    this.T = T;
    built.forEach((ref) => this.local.add(key(ref)));
    this.index = external ?? {
      has: (ref) => this.local.has(key(ref)),
      missing: (from, limit) => {
        const out: number[] = [];
        for (let i = Math.max(from, this.prefix); i < this.T && out.length < limit; i++) if (!this.local.has(key([0, i]))) out.push(i);
        return out;
      },
      ready: (end, limit) => [...this.merges.values()].filter((ref) => endpoint(ref) <= end).sort(compare).slice(0, limit),
    };
    for (const ref of built) this.offer(ref);
    this.advance();
  }
  static restore(T: number, built: readonly Ref[], concurrency: number = QUEUE.slots) { return new WorkQueue(T, built, concurrency); }
  private advance() {
    this.prefix = this.index.missing(this.prefix, 1)[0] ?? this.T;
  }
  get first() { return this.prefix; }
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
    if (running || instant) this.failedNodes.set(id, ref);
  }
  retryFailed() { this.failedNodes.clear(); }
  waitDone(T: number) { return T <= this.first; }

  drain(fits: (ref: Ref) => string | undefined, freeSlots: number): { instant: [Ref, string][]; start: Ref[] } {
    const instant: [Ref, string][] = [], start: Ref[] = [];
    const leaves = this.index.missing(this.first, this.concurrency);
    const horizon = leaves.length === this.concurrency ? leaves.at(-1)! : this.T;
    // Include reservations in the query allowance so they cannot hide runnable work.
    const merges = this.index.ready(horizon, this.concurrency + this.inFlight.size + this.failedNodes.size + this.reserved.size);
    const candidates: Ref[] = [...leaves.map((i): Ref => [0, i]), ...merges].sort(compare);
    let slots = Math.max(0, Math.min(Math.floor(freeSlots), this.concurrency - this.inFlight.size));
    const active = new Set(candidates.map(key));
    for (const id of this.fits.keys()) if (!active.has(id)) this.fits.delete(id);
    for (const ref of candidates) {
      const id = key(ref);
      if (this.inFlight.size >= this.concurrency) break;
      if (this.index.has(ref) || this.inFlight.has(id) || this.failedNodes.has(id) || this.reserved.has(id)) continue;
      if (ref[0] > 0 && !children(ref).every((child) => this.index.has(child))) continue;
      if (!this.fits.has(id)) this.fits.set(id, fits(ref));
      const text = this.fits.get(id);
      if (text !== undefined) { this.reserved.add(id); instant.push([ref, text]); }
      else if (slots > 0) { this.inFlight.add(id); start.push(ref); slots--; }
    }
    return { instant, start };
  }
}

export const isPrefix = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((value, i) => value === b[i]);
