import { utf8Size } from "./record.ts";

export type Ref = readonly [l: number, i: number];
export const NODE_LIMIT = 512;
export const name = (l: number, i: number) => `${first(l, i)}+${2 ** l}`;
export const first = (l: number, i: number) => i * 2 ** l;
export const last = (l: number, i: number) => (i + 1) * 2 ** l - 1;
export const parent = ([l, i]: Ref): Ref => [l + 1, Math.floor(i / 2)];
export const sibling = ([l, i]: Ref): Ref => [l, i % 2 === 0 ? i + 1 : i - 1];

export function children([l, i]: Ref): [Ref, Ref] {
  if (l < 1) throw new RangeError("a leaf has no tree children");
  return [[l - 1, i * 2], [l - 1, i * 2 + 1]];
}

/** The tree's roots over T messages: one node per power of two in T, largest first. */
export function roots(T: number): Ref[] {
  const out: Ref[] = [];
  for (let l = Math.floor(Math.log2(Math.max(T, 1))), id = 0; l >= 0; l--) {
    if (id + 2 ** l <= T) {
      out.push([l, id / 2 ** l]);
      id += 2 ** l;
    }
  }
  return out;
}

export function parseZoom(n: number, id: number): Ref | undefined {
  // The equality check rejects nearby integers that Math.log2 rounds to a whole number.
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isInteger(Math.log2(n)) ||
    n !== 2 ** Math.log2(n) || !Number.isSafeInteger(id) || id < 0 || id % n !== 0) return;
  return [Math.log2(n), id / n];
}

export const leafText = (kind: string, text: string) => {
  const value = `${kind}: ${text}`;
  return utf8Size(value) <= NODE_LIMIT ? value : undefined;
};

export const mergeText = (a: string, b: string) => {
  const value = `${a}\n${b}`;
  return utf8Size(value) <= NODE_LIMIT ? value : undefined;
};
