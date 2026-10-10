import { expect, test } from "bun:test";
import { begin, childItems, enabled, lastUsage, switchMemo, type Memo } from "./turn.ts";
import type { Row } from "./history.ts";

const user: Row = { id: "msg_user", type: "user", text: "task", time: { created: 1000 } };
const idle: Row = { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 1001 } };

test("turn mode changes only at a new idle boundary; restart starts a new memo", () => {
  const cases: { on: boolean; previous?: Memo; key: string; first: boolean; active: boolean }[] = [
    { on: false, key: "start", first: true, active: false },
    { on: true, key: "start", first: true, active: true },
    { on: true, previous: { key: "start", enabled: false }, key: "start", first: false, active: false },
    { on: false, previous: { key: "start", enabled: true }, key: "start", first: false, active: true },
    { on: false, previous: { key: "start", enabled: true }, key: "msg_idle", first: true, active: false },
    { on: true, previous: { key: "start", enabled: false }, key: "msg_idle", first: true, active: true },
    { on: true, key: "msg_idle", first: true, active: true },
  ];
  for (const c of cases) {
    const result = begin(c.key, { on: c.on }, c.previous);
    expect([result.first, result.memo.enabled]).toEqual([c.first, c.active]);
  }
});

test("on while busy defers activation, but off keeps the active turn", () => {
  const busy = switchMemo(true, "start", [user]);
  expect(begin("start", { on: true }, busy).memo.enabled).toBe(false);
  expect(begin("msg_idle", { on: true }, busy).memo.enabled).toBe(true);
  const active: Memo = { key: "start", enabled: true, frozen: { blocks: [], tail: "view" } };
  expect(switchMemo(false, "start", [user], active)).toBe(active);
  expect(switchMemo(true, "start", [], undefined)).toBeUndefined();
  expect(switchMemo(true, "msg_idle", [user, idle], active)).toBeUndefined();
  expect(switchMemo(true, "msg_idle", [idle, user], active)).toEqual({ key: "msg_idle", enabled: false });
});

test("auxiliary hooks and children use the parent switch or enabled memo", () => {
  expect(enabled({ on: false })).toBe(false);
  expect(enabled({ on: true }, { key: "start", enabled: false })).toBe(true);
  expect(enabled({ on: false }, { key: "start", enabled: true })).toBe(true);
  expect(enabled({ on: false }, { key: "start", enabled: false })).toBe(false);
});

test("child sources are disjoint, and keep the split base and attachments", () => {
  const items = [{ kind: "user" as const, text: "task", date: 1000, src: "msg_user", files: [{ name: "x", mime: "text/plain", data: new Uint8Array([1]) }] }, { kind: "echo" as const, text: "output", date: 1001, src: "call_id:result" }];
  expect(childItems("ses_child", items).map((item) => item.src)).toEqual(["ses_child:msg_user", "ses_child:call_id:result"]);
  expect(childItems("ses_child", items)[0]!.files).toEqual(items[0]!.files);
  expect(items[0]!.src).toBe("msg_user");
});

test("popup usage comes from the last assistant, not the idle marker", () => {
  const row: Row = { id: "msg_a", type: "assistant", agent: "build", model: { id: "model", providerID: "anthropic" }, content: [], time: { created: 1000 }, tokens: { input: 12, output: 3, reasoning: 4, cache: { read: 100, write: 20 } }, cost: 0.2 };
  expect(lastUsage([row, idle])).toEqual({ input: 12, output: 3, reasoning: 4, cacheRead: 100, cacheWrite: 20, cost: 0.2 });
  expect(lastUsage([user])).toBeNull();
  expect(lastUsage([{ ...row, time: { created: 1000, completed: 1456 } }, idle])?.ms).toBe(456);
  expect(lastUsage([{ ...row, time: { created: 0, completed: 0 } }])?.ms).toBe(0);
  expect(lastUsage([row])?.ms).toBeUndefined();
});
