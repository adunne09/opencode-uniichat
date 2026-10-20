import { utf8Size } from "./record.ts";
import { children, first, last, name, roots, type Ref } from "./tree.ts";
import { Heap } from "./heap.ts";

export type Lookup = (l: number, i: number) => string | undefined;
export interface View { lines: Ref[]; pending: boolean; size: number }
export type Budget = { high: number; low: number };
export const CHAT_BUDGET: Readonly<Budget> = Object.freeze({ high: 128000, low: 64000 });
export const COMPACTION_BUDGET: Readonly<Budget> = Object.freeze({ high: 32000, low: 16000 });
export const flat = (text: string) => text.replace(/\s*\r?\n\s*/g, " ").replace(/\r/g, " ");
export const renderLine = (ref: Ref, text?: string) => `${name(...ref)}|${flat(text ?? "(not summarized yet: zoom it)")}`;
/** Source budgets measure built node text, not addressing overhead or placeholders. */
export const lineSize = (_ref: Ref, text?: string) => text === undefined ? 0 : utf8Size(text);
export const end = (view: View) => view.lines.length ? last(...view.lines.at(-1)!) + 1 : 0;
export const createView = (lines: readonly Ref[] = [], pending = false, lookup?: Lookup): View => ({
  lines: lines.map(([l, i]) => [l, i]), pending,
  size: lines.reduce((size, ref) => size + lineSize(ref, lookup?.(...ref)), 0),
});
const due = ([l, i]: Ref, T: number) => (T + 1) / 2 ** l - i;
const siblings = (a: Ref, b?: Ref) => b !== undefined && a[0] === b[0] && a[1] % 2 === 0 && b[1] === a[1] + 1;

export function bestPair(lines: readonly Ref[], T: number, lookup: Lookup): number | undefined {
  let best: number | undefined;
  for (let k = 0; k + 1 < lines.length; k++) {
    const a = lines[k]!;
    if (!siblings(a, lines[k + 1]) || lookup(a[0] + 1, a[1] / 2) === undefined) continue;
    if (best === undefined || due(a, T) > due(lines[best]!, T)) best = k;
  }
  return best;
}

/** Heap over a linked view: O(V log V), including newly available ancestor pairs. */
function merge(view: View, lookup: Lookup, low: number): { lines: Ref[]; size: number } {
  const lines: Array<Ref | undefined> = [...view.lines];
  const next = lines.map((_, i) => i + 1), prev = lines.map((_, i) => i - 1);
  const T = end(view);
  type Pair = { at: number; a: Ref; b: Ref; due: number };
  const heap = new Heap<Pair>((a, b) => b.due - a.due || a.at - b.at);
  const offer = (at: number) => {
    const a = lines[at], b = lines[next[at]!];
    if (!a || !b || !siblings(a, b) || lookup(a[0] + 1, a[1] / 2) === undefined) return;
    heap.push({ at, a, b, due: due(a, T) });
  };
  lines.forEach((_, i) => offer(i));
  let size = view.size;
  while (heap.size && size > low) {
    const { at, a, b } = heap.pop()!;
    const right = next[at]!;
    if (lines[at] !== a || lines[right] !== b) continue;
    const up: Ref = [a[0] + 1, a[1] / 2];
    size += lineSize(up, lookup(...up)) - lineSize(a, lookup(...a)) - lineSize(b, lookup(...b));
    lines[at] = up;
    lines[right] = undefined;
    next[at] = next[right]!;
    prev[next[right]!] = at;
    offer(prev[at]!);
    offer(at);
  }
  return { lines: lines.filter((line): line is Ref => line !== undefined), size };
}

export function reach(view: View, T: number, lookup: Lookup) {
  const cut = view.lines.findIndex((ref) => last(...ref) >= T);
  if (cut >= 0) view.lines.splice(cut);
  for (let i = end(view); i < T; i++) view.lines.push([0, i]);
  view.size = view.lines.reduce((size, ref) => size + lineSize(ref, lookup(...ref)), 0);
}

/** Between appends publish only a sufficiently complete batch, as Memory.fit does. */
export function fit(view: View, lookup: Lookup, budget: Budget = CHAT_BUDGET, next = false): boolean {
  view.size = view.lines.reduce((size, ref) => size + lineSize(ref, lookup(...ref)), 0);
  if (view.size <= budget.high && !(next && view.pending)) return false;
  const result = merge(view, lookup, budget.low);
  let changed = false;
  if (next || result.size <= Math.max(budget.low, view.size - budget.high)) {
    changed = result.lines.length !== view.lines.length;
    view.lines = result.lines;
    view.size = result.size;
  }
  view.pending = view.size > budget.low;
  return changed;
}

export function append(view: View, T: number, lookup: Lookup, budget: Budget = CHAT_BUDGET) {
  reach(view, T, lookup);
  return fit(view, lookup, budget, true);
}
export function step(chat: View, comp: View, T: number, lookup: Lookup, compEnd = T,
  chatBudget: Budget = CHAT_BUDGET, compBudget: Budget = COMPACTION_BUDGET, next = true) {
  reach(chat, T, lookup);
  reach(comp, compEnd, lookup);
  return { chatMerged: fit(chat, lookup, chatBudget, next), compMerged: fit(comp, lookup, compBudget, next) };
}
/** Restore a saved cut, or the highest built nodes if no snapshot survives. */
export function restore(T: number, saved: readonly Ref[] | undefined, lookup: Lookup): Ref[] {
  const keys = saved && new Set(saved.map(([l, i]) => `${l}:${i}`));
  const down = (ref: Ref): Ref[] => {
    if (ref[0] === 0 || lookup(...ref) !== undefined && (!keys || keys.has(`${ref[0]}:${ref[1]}`))) return [ref];
    return children(ref).flatMap(down);
  };
  return roots(T).flatMap(down);
}
export function contextFor(comp: View, node: Ref, lookup: Lookup): Ref[] {
  const bound = node[0] === 0 ? first(...node) - 1 : last(...node);
  const out: Ref[] = [];
  for (const ref of comp.lines) {
    if (last(...ref) > bound || lookup(...ref) === undefined) break;
    out.push(ref);
  }
  return out;
}
/** Opening block is the cache fallback for fewer than four lines. */
export function blocks(lines: readonly string[]) {
  const result = ["<chat>\n"];
  const whole = Math.floor(lines.length / 4);
  for (let i = 0; i < whole; i++) result.push(lines.slice(i * 4, i * 4 + 4).map((line) => `${line}\n`).join(""));
  return { blocks: result, tail: `${lines.slice(whole * 4).map((line) => `${line}\n`).join("")}</chat>\n` };
}
export const serialize = (view: View): [number, number][] => view.lines.map(([l, i]) => [l, i]);
export const deserialize = (lines: readonly (readonly number[])[], pending = false, lookup?: Lookup): View => createView(lines.map(([l, i]) => [l, i]), pending, lookup);
export const serializeBatch = (chat: boolean, compaction: boolean) => ({ chat, compaction });
export function cut(lines: readonly Ref[], k: number): Ref[] {
  const add = (ref: Ref): Ref[] => first(...ref) >= k ? [] : last(...ref) < k ? [ref] : children(ref).flatMap(add);
  return lines.flatMap(add);
}
