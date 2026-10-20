import { describe, expect, test } from "bun:test";
import { first, last, type Ref } from "./tree.ts";
import {
  append, bestPair, blocks, CHAT_BUDGET, COMPACTION_BUDGET, contextFor,
  createView, deserialize, fit, lineSize, renderLine, serialize, serializeBatch, step,
  type Budget, type Lookup, type View,
} from "./view.ts";

type States = { keep: number; life: number; state: number; older: States | null };

// R§3.1, with type annotations only.
function push(new_state: number, states: States | null): States {
  if (states === null) {
    return {keep: 0, life: 0, state: new_state, older: null};
  } else {
    var {keep, life, state, older} = states;
    if (keep === 0) {
      return {keep: 1, life, state, older};
    } else {
      if (life > 0) {
        return {keep: 0, life: 0, state: new_state, older: {keep: 0, life: life - 1, state, older}};
      } else {
        return {keep: 0, life, state: new_state, older: push(state, older)};
      }
    }
  }
}

const built: Lookup = () => "built";
const fixed: Lookup = () => "x".repeat(512);
const total = (view: View, lookup: Lookup) => view.lines.reduce((n, ref) => n + lineSize(ref, lookup(...ref)), 0);

describe("view merge order", () => {
  test("matches rollback push at every t from 0 through 20,000", () => {
    let states: States | null = null;
    const lines: Ref[] = [];
    for (let t = 0; t <= 20000; t++) {
      states = push(t, states);
      const expected: [number, number][] = [];
      let end = t + 1;
      for (let entry: States | null = states; entry; entry = entry.older) {
        expected.push([entry.state, Math.log2(end - entry.state)]);
        end = entry.state;
      }
      expected.reverse();
      lines.push([0, t]);
      while (lines.length > expected.length) {
        const at = bestPair(lines, t + 1, built);
        if (at === undefined) throw new Error(`No pair at t=${t}`);
        const [l, i] = lines[at];
        lines.splice(at, 2, [l + 1, i / 2]);
      }
      expect(lines.map(([l, i]) => [first(l, i), l])).toEqual(expected);
    }
  });

  test("T=10 uses the last message, not the first", () => {
    const lines: Ref[] = [[2, 0], [2, 1], [0, 8], [0, 9]];
    expect(bestPair(lines, 10, built)).toBe(2);
  });

  test("ties pick the oldest pair and only built sibling parents qualify", () => {
    expect(bestPair([[1, 0], [1, 1], [0, 4], [0, 5]], 7, built)).toBe(0);
    expect(bestPair([[0, 1], [0, 2]], 3, built)).toBeUndefined();
    expect(bestPair([[0, 0], [1, 1]], 4, built)).toBeUndefined();
    expect(bestPair([[0, 0], [0, 1], [0, 2], [0, 3]], 4, (l, i) => l === 1 && i === 1 ? "" : undefined)).toBe(2);
  });
});

describe("view batches", () => {
  function sawtooth(budget: Budget) {
    const view = createView();
    let batches = 0;
    let growthAfterBatch = 0;
    for (let T = 1; T <= 1000; T++) {
      const before = view.size;
      const prefix = serialize(view);
      const merged = append(view, T, fixed, budget);
      expect(view.size).toBe(total(view, fixed));
      expect(view.size).toBeLessThanOrEqual(budget.high + 512);
      expect(view.pending).toBe(false);
      if (merged) {
        expect(before + 512).toBeGreaterThan(budget.high);
        expect(view.size).toBeLessThanOrEqual(budget.low);
        batches++;
      } else {
        expect(view.size).toBe(before + 512);
        expect(serialize(view).slice(0, -1)).toEqual(prefix);
        if (batches) growthAfterBatch++;
      }
      expect(first(...view.lines[0])).toBe(0);
      expect(last(...view.lines.at(-1)!)).toBe(T - 1);
    }
    expect(batches).toBeGreaterThan(1);
    expect(growthAfterBatch).toBeGreaterThan(20);
  }

  test("chat follows the 128/64 KB sawtooth", () => sawtooth(CHAT_BUDGET));
  test("compaction follows the 32/16 KB sawtooth", () => sawtooth(COMPACTION_BUDGET));

  test("completed parents shrink a pending oversized view without another append", () => {
    let parentsBuilt = false;
    const lookup: Lookup = (l, i) => l === 0 || parentsBuilt ? fixed(l, i) : undefined;
    const view = createView();
    for (let T = 1; T <= 251; T++) expect(append(view, T, lookup)).toBe(false);
    expect(view.size).toBe(251 * 512);
    expect(view.pending).toBe(true);
    parentsBuilt = true;
    expect(view.size).toBe(251 * 512);
    expect(view.lines.length).toBe(251);
    expect(fit(view, lookup)).toBe(true);
    expect(view.size).toBeLessThanOrEqual(64000);
    expect(view.pending).toBe(false);
    expect(view.size).toBe(total(view, lookup));
  });

  test("step maintains independent cuts and stops compaction at its built prefix", () => {
    const chat = createView(Array.from({ length: 250 }, (_, i): Ref => [0, i]), false, fixed);
    const comp = createView([[7, 0]], false, fixed);
    expect(step(chat, comp, 251, fixed, 129)).toEqual({ chatMerged: true, compMerged: false });
    expect(comp.lines).toEqual([[7, 0], [0, 128]]);
    expect(comp.size).toBe(1024);
    expect(comp.size).toBe(total(comp, fixed));
    expect(comp.pending).toBe(false);
    expect(comp.lines).not.toBe(chat.lines);
    expect(comp.lines[0]).not.toBe(chat.lines[0]);
  });

  test("compaction carries its own pending batch when further parents are unbuilt", () => {
    const lookup: Lookup = (l, i) => l <= 1 ? fixed(l, i) : undefined;
    const chat = createView(Array.from({ length: 250 }, (_, i): Ref => [0, i]), false, lookup);
    const comp = createView();
    const result = step(chat, comp, 251, lookup);
    expect(result.chatMerged).toBe(true);
    expect(comp.pending).toBe(true);
    expect(comp.size).toBeGreaterThan(16000);
    expect(comp.size).toBe(total(comp, lookup));
    step(chat, comp, 252, fixed);
    expect(comp.pending).toBe(false);
    expect(comp.size).toBeLessThanOrEqual(16000);
  });

  test("step appends to both views when chat does not merge", () => {
    const chat = createView();
    const comp = createView();
    for (let T = 1; T <= 100; T++) {
      const result = step(chat, comp, T, fixed);
      expect(result.chatMerged).toBe(false);
      expect(comp.size).toBe(total(comp, fixed));
    }
    expect(chat.lines.length).toBe(100);
    expect(comp.lines.length).toBeLessThan(100);
  });

  test("equal high does not start a batch; equal low clears it", () => {
    const view = createView();
    const budget = { high: 1024, low: 1024 };
    expect(append(view, 1, fixed, budget)).toBe(false);
    expect(append(view, 2, fixed, budget)).toBe(false);
    expect(view.pending).toBe(false);
    expect(append(view, 3, fixed, budget)).toBe(true);
    expect(view.size).toBe(1024);
    expect(view.pending).toBe(false);
  });

  test("each view can finish its pending batch independently", () => {
    const comp = createView([[0, 0]], true, fixed);
    // The restored chat batch needs one merge before it reaches its low bound.
    const largeLeaf: Lookup = (l) => l === 0 ? "x".repeat(40000) : "";
    const resumed = createView([[0, 0]], true, largeLeaf);
    expect(step(resumed, comp, 2, largeLeaf)).toEqual({ chatMerged: true, compMerged: true });
    expect(comp.lines).toEqual([[1, 0]]);
    expect(comp.size).toBe(0);
    expect(comp.pending).toBe(false);
  });
});

describe("view rendering and persistence", () => {
  test("budgets count built UTF-8 text only, excluding addresses and placeholders", () => {
    expect(renderLine([3, 5], "é\r\n猫\r🙂\nx")).toBe("40+8|é 猫 🙂 x");
    expect(lineSize([3, 5], "é\r\n猫\r🙂\nx")).toBe(14);
    expect(renderLine([0, 0])).toBe("0+1|(not summarized yet: zoom it)");
    expect(lineSize([0, 0])).toBe(0);
    expect(renderLine([0, 0], "")).toBe("0+1|");
    let text: string | undefined;
    const lookup: Lookup = () => text;
    const view = createView([[0, 0]], false, lookup);
    text = "猫🙂";
    expect(view.size).toBe(0);
    append(view, 2, lookup);
    expect(view.size).toBe(14);
    expect(view.size).toBe(total(view, lookup));
  });

  test("context respects inclusive merge bounds and exclusive leaf bounds", () => {
    const comp = createView([[1, 0], [0, 2], [0, 3], [1, 2]]);
    expect(contextFor(comp, [0, 0], built)).toEqual([]);
    expect(contextFor(comp, [0, 2], built)).toEqual([[1, 0]]);
    expect(contextFor(comp, [1, 1], built)).toEqual([[1, 0], [0, 2], [0, 3]]);
    expect(contextFor(comp, [0, 5], built)).toEqual([[1, 0], [0, 2], [0, 3]]);
    expect(contextFor(comp, [2, 1], (l, i) => l === 0 && i === 2 ? undefined : "")).toEqual([[1, 0]]);
  });

  test("D35 places closing tags only in the tail for 0 through 9 lines", () => {
    for (let n = 0; n <= 9; n++) {
      const lines = Array.from({ length: n }, (_, i) => `L${i}`);
      const result = blocks(lines);
      expect(result.blocks.length).toBe(1 + Math.floor(n / 4));
      expect(result.blocks[0]).toBe("<chat>\n");
      for (let b = 1; b < result.blocks.length; b++) {
        expect(result.blocks[b]).toBe(`${lines.slice((b - 1) * 4, b * 4).join("\n")}\n`);
      }
      const rest = lines.slice(Math.floor(n / 4) * 4);
      expect(result.tail).toBe(`${rest.map((line) => `${line}\n`).join("")}</chat>\n`);
      expect([...result.blocks, result.tail].join("")).toBe(`<chat>\n${lines.map((line) => `${line}\n`).join("")}</chat>\n`);
    }
  });

  test("D28 round-trips line pairs, byte totals, and pending flags", () => {
    const view = createView([[2, 0], [1, 2], [0, 6]], true, fixed);
    const encoded = JSON.stringify(serialize(view));
    expect(encoded).toBe("[[2,0],[1,2],[0,6]]");
    const flags = JSON.parse(JSON.stringify(serializeBatch(view.pending, false)));
    expect(flags).toEqual({ chat: true, compaction: false });
    const restored = deserialize(JSON.parse(encoded), flags.chat, fixed);
    expect(restored).toEqual(view);
    expect(append(restored, 8, fixed)).toBe(append(view, 8, fixed));
    expect(restored).toEqual(view);
    const placeholders = deserialize([[0, 0]]);
    expect(placeholders.size).toBe(lineSize([0, 0]));
    append(placeholders, 2, fixed);
    expect(placeholders.size).toBe(1024);
  });
});
