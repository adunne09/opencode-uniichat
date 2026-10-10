import { utf8Size } from "./record.ts";
import { first, last, name, type Ref } from "./tree.ts";

export type Lookup = (l: number, i: number) => string | undefined;
export interface View {
  lines: Ref[];
  pending: boolean;
  size: number;
}
export type Budget = { high: number; low: number };
export const CHAT_BUDGET = { high: 128000, low: 64000 };
export const COMPACTION_BUDGET = { high: 32000, low: 16000 };

type Measurements = { sizes: Map<Ref, number>; unbuilt: Set<Ref> };
const measurements = new WeakMap<View, Measurements>();

export function renderLine(ref: Ref, text?: string): string {
  return `${name(...ref)}|${(text ?? "(not summarized yet: zoom it)").replace(/\r\n|\r|\n/g, " ")}`;
}

export const lineSize = (ref: Ref, text?: string): number => utf8Size(renderLine(ref, text)) + 1;

function measure(view: View, ref: Ref, text: string | undefined): void {
  const data = measurements.get(view)!;
  const size = lineSize(ref, text);
  view.size += size - (data.sizes.get(ref) ?? 0);
  data.sizes.set(ref, size);
  if (text === undefined) data.unbuilt.add(ref);
  else data.unbuilt.delete(ref);
}

export function createView(lines: readonly Ref[] = [], pending = false, lookup?: Lookup): View {
  const view: View = { lines: lines.map(([l, i]) => [l, i]), pending, size: 0 };
  measurements.set(view, { sizes: new Map(), unbuilt: new Set() });
  for (const ref of view.lines) measure(view, ref, lookup?.(...ref));
  return view;
}

export function bestPair(lines: readonly Ref[], T: number, lookup: Lookup): number | undefined {
  let best: number | undefined;
  let bestAge = 0n;
  let bestSpan = 1n;
  let bestFirst = 0;
  for (let at = 0; at + 1 < lines.length; at++) {
    const [l, i] = lines[at];
    const [rl, ri] = lines[at + 1];
    if (l !== rl || i % 2 !== 0 || ri !== i + 1 || lookup(l + 1, i / 2) === undefined) continue;
    const age = BigInt(T) - BigInt(last(l, ri));
    const span = 1n << BigInt(l);
    const start = first(l, i);
    // Cross multiplication keeps the due comparison exact.
    const difference = age * bestSpan - bestAge * span;
    if (best === undefined || difference > 0n || (difference === 0n && start < bestFirst)) {
      best = at;
      bestAge = age;
      bestSpan = span;
      bestFirst = start;
    }
  }
  return best;
}

function mergeBatch(view: View, T: number, lookup: Lookup, low: number): boolean {
  const data = measurements.get(view)!;
  let merged = false;
  while (view.pending) {
    if (view.size <= low) {
      view.pending = false;
      break;
    }
    const at = bestPair(view.lines, T, lookup);
    if (at === undefined) break;
    const [l, i] = view.lines[at];
    for (const ref of view.lines.slice(at, at + 2)) {
      view.size -= data.sizes.get(ref)!;
      data.sizes.delete(ref);
      data.unbuilt.delete(ref);
    }
    const parent: Ref = [l + 1, i / 2];
    view.lines.splice(at, 2, parent);
    measure(view, parent, lookup(...parent));
    merged = true;
  }
  return merged;
}

export function append(view: View, T: number, lookup: Lookup, budget: Budget = CHAT_BUDGET): boolean {
  if (!measurements.has(view)) {
    measurements.set(view, { sizes: new Map(), unbuilt: new Set() });
    view.size = 0;
    for (const ref of view.lines) measure(view, ref, lookup(...ref));
  }
  // Built nodes do not change. Update only the lines that were placeholders.
  for (const ref of measurements.get(view)!.unbuilt) measure(view, ref, lookup(...ref));
  const leaf: Ref = [0, T - 1];
  view.lines.push(leaf);
  measure(view, leaf, lookup(...leaf));
  if (!view.pending && view.size > budget.high) view.pending = true;
  return mergeBatch(view, T, lookup, budget.low);
}

export function step(chat: View, comp: View, T: number, lookup: Lookup) {
  const chatMerged = append(chat, T, lookup);
  let compMerged: boolean;
  if (chatMerged) {
    const copy = createView(chat.lines, chat.size > COMPACTION_BUDGET.low, lookup);
    comp.lines = copy.lines;
    comp.size = copy.size;
    comp.pending = copy.pending;
    measurements.set(comp, measurements.get(copy)!);
    compMerged = mergeBatch(comp, T, lookup, COMPACTION_BUDGET.low);
  } else {
    compMerged = append(comp, T, lookup, COMPACTION_BUDGET);
  }
  return { chatMerged, compMerged };
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

export function blocks(lines: readonly string[]) {
  const result: string[] = [];
  for (let i = 0; i + 4 <= lines.length; i += 4) {
    result.push(`${i === 0 ? "<chat>\n" : ""}${lines.slice(i, i + 4).map((line) => `${line}\n`).join("")}`);
  }
  const rest = lines.slice(result.length * 4).map((line) => `${line}\n`).join("");
  return { blocks: result, tail: `${result.length ? "" : "<chat>\n"}${rest}</chat>` };
}

export const serialize = (view: View): [number, number][] => view.lines.map(([l, i]) => [l, i]);
export const deserialize = (lines: readonly (readonly number[])[], pending = false, lookup?: Lookup): View => createView(lines.map(([l, i]) => [l, i]), pending, lookup);
export const serializeBatch = (chat: boolean, compaction: boolean) => ({ chat, compaction });
