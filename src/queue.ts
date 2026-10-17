import { first, parent, sibling, type Ref } from "./tree.ts";

const key = ([l, i]: Ref): string => `${l}:${i}`;
const compare = (a: Ref, b: Ref): number => first(...a) - first(...b) || a[0] - b[0];

class MergeHeap {
  private items: Ref[];

  constructor(items: Ref[] = []) {
    this.items = items;
    for (let i = Math.floor(items.length / 2) - 1; i >= 0; i--) {
      this.down(i);
    }
  }

  push(ref: Ref): void {
    let i = this.items.length;
    this.items.push(ref);
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (compare(this.items[p]!, ref) <= 0) break;
      this.items[i] = this.items[p]!;
      i = p;
    }
    this.items[i] = ref;
  }

  pop(): Ref | undefined {
    const ref = this.items[0];
    const tail = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = tail!;
      this.down(0);
    }
    return ref;
  }

  private down(i: number): void {
    const ref = this.items[i]!;
    while (2 * i + 1 < this.items.length) {
      let child = 2 * i + 1;
      if (child + 1 < this.items.length && compare(this.items[child + 1]!, this.items[child]!) < 0) {
        child++;
      }
      if (compare(ref, this.items[child]!) <= 0) break;
      this.items[i] = this.items[child]!;
      i = child;
    }
    this.items[i] = ref;
  }
}

/** Compaction calls in flight at once (recipe: 8); set from the plugin options. */
export const QUEUE = { slots: 8 };

export class WorkQueue {
  T = 0;
  p = 0;
  readonly builtNodes = new Set<string>();
  readonly inFlight = new Set<string>();
  readonly failedNodes = new Map<string, Ref>();
  private readonly instantPending = new Set<string>();
  private unbuiltStartedLeaves = 0;
  private donePrefix = 0;
  private retryLeaves: Ref[] = [];
  private merges = new MergeHeap();
  private instantMerges = new MergeHeap();
  private unclassifiedMerges: Ref[] = [];
  private fitResults = new Map<string, string | undefined>();
  private queuedMerges = new Set<string>();

  constructor(T = 0, builtRefs: readonly Ref[] = []) {
    this.T = T;
    const ready: Ref[] = [];
    for (const ref of builtRefs) {
      this.builtNodes.add(key(ref));
      this.queuedMerges.delete(key(ref));
      const next = parent(ref);
      const id = key(next);
      if (this.builtNodes.has(key(sibling(ref))) && !this.builtNodes.has(id) && !this.queuedMerges.has(id)) {
        this.queuedMerges.add(id);
        ready.push(next);
      }
    }
    this.unclassifiedMerges = ready.filter((ref) => !this.builtNodes.has(key(ref)));
    this.advance();
  }

  static restore(T: number, builtRefs: readonly Ref[]): WorkQueue {
    return new WorkQueue(T, builtRefs);
  }

  append(T: number): void {
    if (T < this.T) throw new RangeError("T cannot decrease");
    this.T = T;
    this.advance();
  }

  private advance(): void {
    // Each pointer passes each leaf at most once.
    while (this.p < this.T && this.builtNodes.has(key([0, this.p]))) {
      this.p++;
    }
    while (this.donePrefix < this.T && this.builtNodes.has(key([0, this.donePrefix]))) {
      this.donePrefix++;
    }
  }

  private queueMerge(ref: Ref): void {
    const id = key(ref);
    if (this.builtNodes.has(id) || this.inFlight.has(id) ||
      this.failedNodes.has(id) || this.queuedMerges.has(id)) return;
    this.queuedMerges.add(id);
    if (!this.fitResults.has(id)) {
      this.unclassifiedMerges.push(ref);
    } else if (this.fitResults.get(id) !== undefined) {
      this.instantMerges.push(ref);
    } else {
      this.merges.push(ref);
    }
  }

  built(ref: Ref): void {
    const id = key(ref);
    if (this.builtNodes.has(id)) return;
    this.builtNodes.add(id);
    this.inFlight.delete(id);
    this.instantPending.delete(id);
    this.failedNodes.delete(id);
    if (ref[0] === 0 && ref[1] < this.p) {
      this.unbuiltStartedLeaves--;
    }
    this.advance();
    if (this.builtNodes.has(key(sibling(ref)))) this.queueMerge(parent(ref));
  }

  failed(ref: Ref): void {
    const id = key(ref);
    const running = this.inFlight.delete(id);
    const instant = this.instantPending.delete(id);
    if (!running && !instant) return;
    this.failedNodes.set(id, ref);
  }

  retryFailed(): void {
    for (const ref of this.failedNodes.values()) {
      if (ref[0] === 0) this.retryLeaves.push(ref);
    }
    const merges = [...this.failedNodes.values()].filter((ref) => ref[0] > 0);
    this.failedNodes.clear();
    this.retryLeaves.sort(compare);
    for (const ref of merges) {
      this.queueMerge(ref);
    }
  }

  private fit(ref: Ref, fits: (ref: Ref) => string | undefined): string | undefined {
    const id = key(ref);
    if (!this.fitResults.has(id)) {
      this.fitResults.set(id, fits(ref));
    }
    return this.fitResults.get(id);
  }

  private classifyMerges(fits: (ref: Ref) => string | undefined): void {
    for (const ref of this.unclassifiedMerges) {
      if (this.builtNodes.has(key(ref))) continue;
      if (this.fit(ref, fits) !== undefined) {
        this.instantMerges.push(ref);
      } else {
        this.merges.push(ref);
      }
    }
    this.unclassifiedMerges = [];
  }

  waitDone(T: number): boolean {
    return T <= this.donePrefix;
  }

  drain(fits: (ref: Ref) => string | undefined, freeSlots: number): { instant: [Ref, string][]; start: Ref[] } {
    const instant: [Ref, string][] = [];
    const start: Ref[] = [];
    let slots = Math.max(0, Math.min(Math.floor(freeSlots), QUEUE.slots - this.inFlight.size));
    const complete = (ref: Ref, text: string): void => {
      this.instantPending.add(key(ref));
      instant.push([ref, text]);
    };
    const call = (ref: Ref): void => {
      this.inFlight.add(key(ref));
      start.push(ref);
      slots--;
    };

    while (this.retryLeaves.length > 0 || (this.p < this.T && this.unbuiltStartedLeaves < 8)) {
      const retry = this.retryLeaves[0];
      const ref: Ref = retry ?? [0, this.p];
      if (this.builtNodes.has(key(ref))) {
        this.retryLeaves.shift();
        continue;
      }
      const text = this.fit(ref, fits);
      if (text === undefined && slots === 0) break;
      if (retry) {
        this.retryLeaves.shift();
      } else {
        this.p++;
        this.unbuiltStartedLeaves++;
        this.advance();
      }
      if (text !== undefined) {
        complete(ref, text);
      } else {
        call(ref);
      }
    }

    this.classifyMerges(fits);
    let ref: Ref | undefined;
    while ((ref = this.instantMerges.pop()) !== undefined) {
      this.queuedMerges.delete(key(ref));
      if (this.builtNodes.has(key(ref))) continue;
      complete(ref, this.fitResults.get(key(ref))!);
      this.classifyMerges(fits);
    }
    while (slots > 0 && (ref = this.merges.pop()) !== undefined) {
      this.queuedMerges.delete(key(ref));
      if (this.builtNodes.has(key(ref))) continue;
      call(ref);
    }
    return { instant, start };
  }
}

export const isPrefix = (a: readonly string[], b: readonly string[]): boolean =>
  a.length <= b.length && a.every((value, i) => value === b[i]);
