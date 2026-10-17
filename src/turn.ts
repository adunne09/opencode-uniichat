import type { Item, Row } from "./history.ts";

export interface Switch { on: boolean; render?: boolean }
export interface Memo {
  key: string;
  enabled: boolean;
  frozen?: { blocks: readonly string[]; tail: string };
}

export function enabled(state: Switch, memo?: Memo): boolean {
  return state.on || memo?.enabled === true;
}

export function begin(key: string, state: Switch, memo?: Memo): { memo: Memo; first: boolean } {
  return memo?.key === key ? { memo, first: false } : { memo: { key, enabled: state.on }, first: true };
}

export function switchMemo(on: boolean, key: string, rows: readonly Row[], memo?: Memo): Memo | undefined {
  if (!on || memo?.enabled && memo.key === key) return memo;
  return rows.length && rows.at(-1)?.type !== "idle" ? { key, enabled: false } : undefined;
}

export function childItems(sessionID: string, items: readonly Item[]): Item[] {
  return items.map((item) => ({ ...item, src: `${sessionID}:${item.src}` }));
}

export function lastUsage(rows: readonly Row[]) {
  // Prefer the last finished step: the one still streaming has no usage yet.
  const row = rows.findLast((row) => row.type === "assistant" && row.time.completed !== undefined)
    ?? rows.findLast((row) => row.type === "assistant");
  if (row?.type !== "assistant") return null;
  return {
    input: row.tokens?.input ?? 0,
    output: row.tokens?.output ?? 0,
    reasoning: row.tokens?.reasoning ?? 0,
    cacheRead: row.tokens?.cache.read ?? 0,
    cacheWrite: row.tokens?.cache.write ?? 0,
    cost: row.cost ?? 0,
    ...(row.time.completed === undefined ? {} : { ms: row.time.completed - row.time.created }),
  };
}
