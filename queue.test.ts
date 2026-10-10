import { describe, expect, test } from "bun:test";
import { isPrefix, WorkQueue } from "./queue.ts";
import { children, type Ref } from "./tree.ts";

const id = ([l, i]: Ref): string => `${l}:${i}`;
const noFit = (): undefined => undefined;
const timeout = 2_000;
function committedDrain(q: WorkQueue, fits: (ref: Ref) => string | undefined, slots: number) {
  const result: { instant: [Ref, string][]; start: Ref[] } = { instant: [], start: [] };
  while (true) {
    const work = q.drain(fits, slots - result.start.length);
    result.instant.push(...work.instant);
    result.start.push(...work.start);
    for (const [ref] of work.instant) q.built(ref);
    if (!work.instant.length) return result;
  }
}

describe("work scheduler", () => {
  test("holds fitting leaves behind the eight-leaf window", () => {
    const q = new WorkQueue(12);
    expect(q.drain(noFit, 8).start).toEqual(Array.from({ length: 8 }, (_, i) => [0, i]));
    expect(q.drain(() => "short", 0).instant).toEqual([]);
    q.built([0, 7]);
    const work = committedDrain(q, (ref) => ref[0] === 0 ? "short" : undefined, 0);
    expect(work.instant.map(([ref]) => ref)).toEqual([[0, 8], [0, 9], [0, 10], [0, 11]]);
  }, timeout);

  test("caps calls at eight across drains even with excess free slots", () => {
    const q = WorkQueue.restore(20, [[0, 0], [0, 1]]);
    expect(q.drain(noFit, 100).start).toHaveLength(8);
    expect(q.drain(noFit, 100).start).toEqual([]);
    q.built([0, 2]);
    expect(q.drain(noFit, 100).start).toEqual([[0, 10]]);
  }, timeout);

  test("starts oldest leaves before oldest ready merges", () => {
    const q = WorkQueue.restore(7, [[0, 3], [0, 2], [0, 1], [0, 0]]);
    expect(q.drain(noFit, 8).start).toEqual([[0, 4], [0, 5], [0, 6], [1, 0], [1, 1]]);
  }, timeout);

  test("retries old leaves before new leaves and merges", () => {
    const q = new WorkQueue(4);
    q.drain(noFit, 4);
    q.built([0, 0]);
    q.built([0, 1]);
    q.failed([0, 3]);
    q.failed([0, 2]);
    q.append(5);
    q.retryFailed();
    expect(q.drain(noFit, 8).start).toEqual([[0, 2], [0, 3], [0, 4], [1, 0]]);
  }, timeout);

  test("instant nodes use no slot and complete all merge levels", () => {
    const q = new WorkQueue(8);
    const work = committedDrain(q, () => "short", 0);
    expect(work.start).toEqual([]);
    expect(work.instant).toHaveLength(15);
    expect(work.instant.at(-1)).toEqual([[3, 0], "short"]);
    expect(q.waitDone(8)).toBe(true);
    expect(q.drain(() => "short", 0)).toEqual({ instant: [], start: [] });
  }, timeout);

  test("instant reservations are not built until persistence commits them", () => {
    const q = new WorkQueue(2);
    const fits = (ref: Ref) => ref[0] === 0 && ref[1] === 0 ? "short" : undefined;
    const work = q.drain(fits, 8);
    expect(work).toEqual({ instant: [[[0, 0], "short"]], start: [[0, 1]] });
    expect(q.waitDone(1)).toBe(false);
    q.failed([0, 0]);
    q.failed([0, 1]);
    expect(q.inFlight.size).toBe(0);
    q.retryFailed();
    expect(q.drain(fits, 8)).toEqual(work);
    q.built([0, 0]);
    expect(q.waitDone(1)).toBe(true);
    expect(q.waitDone(2)).toBe(false);
  }, timeout);

  test("a blocked leaf and blocked older merge do not block instant merges", () => {
    const q = WorkQueue.restore(5, [[0, 0], [0, 1], [0, 2], [0, 3]]);
    const work = q.drain((ref) => id(ref) === "1:1" ? "short" : undefined, 0);
    expect(work).toEqual({ instant: [[[1, 1], "short"]], start: [] });
    expect(q.drain(noFit, 1).start).toEqual([[0, 4]]);
    expect(q.drain(noFit, 1).start).toEqual([[1, 0]]);
  }, timeout);

  test("merges wait for both halves and build only once", () => {
    const q = new WorkQueue(2);
    q.drain(noFit, 2);
    q.built([0, 1]);
    expect(q.drain(noFit, 8).start).toEqual([]);
    q.built([0, 0]);
    q.built([0, 0]);
    expect(q.drain(noFit, 8).start).toEqual([[1, 0]]);
    q.built([0, 1]);
    expect(q.drain(noFit, 8).start).toEqual([]);
    q.built([1, 0]);
    expect(q.drain(noFit, 8).start).toEqual([]);
  }, timeout);

  test("failed leaves keep the window full until they build", () => {
    const q = new WorkQueue(10);
    const work = q.drain(noFit, 8);
    for (const ref of work.start) q.failed(ref);
    expect(q.drain(() => "short", 8).instant).toEqual([]);
    q.retryFailed();
    q.retryFailed();
    expect(q.drain(noFit, 8).start).toEqual(work.start);
    q.built([0, 0]);
    expect(q.drain(noFit, 8).start).toEqual([[0, 8]]);
  }, timeout);

  test("failed merges stay failed until retried and keep their fit classification", () => {
    const q = WorkQueue.restore(2, [[0, 0], [0, 1]]);
    let visits = 0;
    const fits = (): undefined => {
      visits++;
      return undefined;
    };
    q.drain(fits, 1);
    q.failed([1, 0]);
    expect(q.drain(fits, 8).instant).toEqual([]);
    q.retryFailed();
    expect(q.drain(fits, 0).start).toEqual([]);
    expect(q.drain(fits, 1).start).toEqual([[1, 0]]);
    q.built([1, 0]);
    q.retryFailed();
    expect(q.drain(fits, 8).start).toEqual([]);
    expect(visits).toBe(1);
  }, timeout);

  test("zero-slot drains do not revisit classified leaves or merges", () => {
    const q = WorkQueue.restore(5, [[0, 0], [0, 1], [0, 2], [0, 3]]);
    let visits = 0;
    const fits = (): undefined => {
      visits++;
      return undefined;
    };
    expect(q.drain(fits, 0)).toEqual({ instant: [], start: [] });
    expect(visits).toBe(3);
    for (let i = 0; i < 100; i++) {
      expect(q.drain(fits, 0)).toEqual({ instant: [], start: [] });
    }
    expect(visits).toBe(3);
    expect(q.drain(fits, 1).start).toEqual([[0, 4]]);
    expect(q.drain(fits, 1).start).toEqual([[1, 0]]);
    expect(visits).toBe(3);
  }, timeout);

  test("large restore classifies each merge once and idle drains leave calls queued", () => {
    const leaves: Ref[] = Array.from({ length: 10_000 }, (_, i) => [0, i]);
    const q = WorkQueue.restore(leaves.length, leaves);
    const visits = new Map<string, number>();
    const fits = (ref: Ref): undefined => {
      const k = id(ref);
      visits.set(k, (visits.get(k) ?? 0) + 1);
      return undefined;
    };
    expect(q.drain(fits, 0)).toEqual({ instant: [], start: [] });
    expect(visits.size).toBe(5_000);
    for (let i = 0; i < 1_000; i++) {
      expect(q.drain(fits, 0)).toEqual({ instant: [], start: [] });
    }
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
    expect(q.drain(fits, 1).start).toEqual([[1, 0]]);
    q.built([1, 0]);
    expect(q.drain(fits, 1).start).toEqual([[1, 1]]);
    q.built([1, 1]);
    expect(q.drain(fits, 0)).toEqual({ instant: [], start: [] });
    expect(visits.get("2:0")).toBe(1);
    expect(visits.size).toBe(5_001);
    expect(q.drain(fits, 1).start).toEqual([[2, 0]]);
    for (let i = 0; i < 100; i++) {
      q.drain(fits, 0);
    }
    expect([...visits.values()].every((count) => count === 1)).toBe(true);
  }, timeout);

  test("restore skips out-of-order built leaves without counting them", () => {
    const q = WorkQueue.restore(14, [[0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [0, 12]]);
    expect(q.p).toBe(1);
    expect(q.drain(noFit, 8).start).toEqual([1, 3, 5, 7, 9, 11, 13].map((i) => [0, i]));
    expect(q.waitDone(14)).toBe(false);
    for (const i of [13, 11, 9, 7, 5, 3, 1]) q.built([0, i]);
    expect(q.waitDone(14)).toBe(true);
    expect(q.drain(noFit, 8).start).toEqual(Array.from({ length: 7 }, (_, i) => [1, i]));
  }, timeout);

  test("restore queues built siblings but not their built parent", () => {
    const q = WorkQueue.restore(4, [[1, 1], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0]]);
    expect(q.drain(noFit, 8).start).toEqual([[2, 0]]);
  }, timeout);

  test("waitDone tracks a completed prefix, not total leaf completions or merges", () => {
    const q = new WorkQueue(4);
    expect(q.waitDone(0)).toBe(true);
    q.drain(noFit, 4);
    q.built([0, 3]);
    q.built([0, 1]);
    expect(q.waitDone(1)).toBe(false);
    q.built([0, 0]);
    expect(q.waitDone(2)).toBe(true);
    expect(q.waitDone(3)).toBe(false);
    q.built([0, 2]);
    expect(q.waitDone(4)).toBe(true);
    q.append(5);
    expect(q.waitDone(4)).toBe(true);
    expect(q.waitDone(5)).toBe(false);
  }, timeout);

  test("checks prefixes including empty and equal prefixes", () => {
    expect(isPrefix([], ["a"])).toBe(true);
    expect(isPrefix(["a"], ["a"])).toBe(true);
    expect(isPrefix(["a"], ["a", "b"])).toBe(true);
    expect(isPrefix(["a", "b"], ["a"])).toBe(false);
    expect(isPrefix(["b"], ["a", "b"])).toBe(false);
  }, timeout);

  test("seeded 2,000-message simulation preserves all scheduling rules", () => {
    let seed = 0x71c4;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const q = new WorkQueue();
    const built = new Set<string>();
    const running: Ref[] = [];
    const fitting = new Map<string, boolean>();
    const checkReady = (ref: Ref): void => {
      expect(built.has(id(ref))).toBe(false);
      if (ref[0] === 0) {
        let earlier = 0;
        for (let i = 0; i < ref[1]; i++) if (!built.has(id([0, i]))) earlier++;
        expect(earlier).toBeLessThan(8);
      } else {
        for (const child of children(ref)) expect(built.has(id(child))).toBe(true);
      }
    };
    const fits = (ref: Ref): string | undefined => {
      checkReady(ref);
      const k = id(ref);
      if (!fitting.has(k)) fitting.set(k, random() < 0.45);
      if (!fitting.get(k)) return undefined;
      built.add(k);
      return "short";
    };
    let steps = 0;
    while (steps++ < 20_000) {
      if (q.T < 2_000 && (running.length === 0 || random() < 0.7)) q.append(q.T + 1);
      if (running.length > 0 && random() < 0.8) {
        const [ref] = running.splice(Math.floor(random() * running.length), 1);
        expect(built.has(id(ref!))).toBe(false);
        built.add(id(ref!));
        q.built(ref!);
      }
      const work = q.drain(fits, 8 - running.length);
      for (const [ref] of work.instant) q.built(ref);
      for (const ref of work.start) {
        expect(running.some((other) => id(other) === id(ref))).toBe(false);
        running.push(ref);
      }
      expect(running.length).toBeLessThanOrEqual(8);
      if (q.T === 2_000 && running.length === 0 && work.start.length === 0 && work.instant.length === 0) break;
    }
    expect(steps).toBeLessThan(20_000);
    expect(q.waitDone(2_000)).toBe(true);
    let expected = 0;
    for (let l = 0; 2 ** l <= 2_000; l++) {
      for (let i = 0; i < Math.floor(2_000 / 2 ** l); i++) {
        expect(built.has(id([l, i]))).toBe(true);
        expected++;
      }
    }
    expect(built.size).toBe(expected);
  }, timeout);
});
