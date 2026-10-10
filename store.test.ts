import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "@opencode/util/global";
import { Effect } from "effect";
import { utf8Size, type LogRecord } from "./record.ts";
import { chatDir, Store } from "./store.ts";

const run = Effect.runPromise;
const temp = () => mkdtempSync("/tmp/opencode/uniichat-store-");
const record = (i: number, date = "2026-10-09T12:00:00"): LogRecord => ({
  i, kind: "user", text: `Message ${i}: café\nnext`, size: utf8Size(`Message ${i}: café\nnext`), date, src: `msg_${i}:0`,
});

const snapshotNames = ["view.json", "compaction-view.json", "view-batch.json"];
const nextSnapshot = ["[[1,0]]", "[[1,0]]", '{"chat":true,"compaction":true}'];

for (let staged = 0; staged <= 3; staged++) {
  test(`snapshot crash after ${staged} temp writes keeps the previous snapshot`, async () => {
    const dir = temp();
    const store = await run(Store.open(dir));
    await run(store.saveViews([[0, 0], [0, 1]], [[0, 0], [0, 1]], { chat: false, compaction: false }));
    for (let i = 0; i < staged; i++) writeFileSync(join(dir, `${snapshotNames[i]}.tmp`), nextSnapshot[i]!);
    const loaded = await run((await run(Store.open(dir))).load());
    expect(loaded.view).toEqual([[0, 0], [0, 1]]);
    expect(loaded.compView).toEqual(loaded.view);
    expect(loaded.batch).toEqual({ chat: false, compaction: false });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp") || name === "snapshot.commit")).toEqual([]);
  });
}

for (let renamed = 0; renamed <= 3; renamed++) {
  test(`snapshot crash after commit and ${renamed} renames finishes all three files`, async () => {
    const dir = temp();
    const store = await run(Store.open(dir));
    await run(store.saveViews([[0, 0], [0, 1]], [[0, 0], [0, 1]], { chat: false, compaction: false }));
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `${snapshotNames[i]}.tmp`), nextSnapshot[i]!);
    writeFileSync(join(dir, "snapshot.commit"), "");
    for (let i = 0; i < renamed; i++) renameSync(join(dir, `${snapshotNames[i]}.tmp`), join(dir, snapshotNames[i]!));
    const reopened = await run(Store.open(dir));
    const loaded = await run(reopened.load());
    expect(loaded.view).toEqual([[1, 0]]);
    expect(loaded.compView).toEqual(loaded.view);
    expect(loaded.batch).toEqual({ chat: true, compaction: true });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp") || name === "snapshot.commit")).toEqual([]);
    expect(await run(reopened.load())).toEqual(loaded);
  });
}

for (let renamed = 0; renamed < 3; renamed++) {
  test(`failed publication retains the commit marker after ${renamed} renames`, async () => {
    const dir = temp();
    const store = await run(Store.open(dir));
    await run(store.saveViews([], [], { chat: false, compaction: false }));
    const original = fs.renameSync;
    let count = 0;
    const fault = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).startsWith(`${dir}/`) && count++ === renamed) throw new Error("crash");
      return original(from, to);
    });
    try {
      expect((await run(Effect.result(store.saveViews([[1, 0]], [[1, 0]], { chat: true, compaction: true }))))._tag).toBe("Failure");
      expect(fs.existsSync(join(dir, "snapshot.commit"))).toBe(true);
    } finally { fault.mockRestore(); }
    const loaded = await run((await run(Store.open(dir))).load());
    expect(loaded.view).toEqual([[1, 0]]);
    expect(loaded.compView).toEqual(loaded.view);
    expect(loaded.batch).toEqual({ chat: true, compaction: true });
  });
}

test("round trip all storage after reopen without rebuilding views", async () => {
  expect(chatDir("session-1")).toBe(join(Path.data, "uniichat", "session-1"));
  const dir = temp();
  const store = await run(Store.open(dir));
  const a = record(1, "2026-10-08T12:00:00");
  const b = record(0);
  await run(store.appendRecord(a));
  await run(store.appendRecord(b));
  const node = { l: 1, i: 0, text: "two messages", size: 12 };
  await run(store.appendNode(node));
  await run(store.saveViews([[1, 0]], [[0, 0], [0, 1]], { chat: true, compaction: false }));
  await run(store.saveSystem("frozen\nsystem"));
  await run(store.saveSystem("frozen\nsystem"));
  await run(store.appendAgent("explore-1", record(0)));
  await run(store.appendAgent("explore-1", record(1)));
  const data = new Uint8Array([0, 255, 128, 42]);
  expect(await run(store.saveFile("0-0.png", data))).toBe("files/0-0.png");
  const reopened = await run(Store.open(dir));
  const loaded = await run(reopened.load());
  expect(loaded).toEqual({
    records: [b, a], nodes: [node], view: [[1, 0]], compView: [[0, 0], [0, 1]],
    batch: { chat: true, compaction: false }, system: "frozen\nsystem",
    agents: new Map([["explore-1", [record(0), record(1)]]]), tornLines: [],
  });
  expect(await run(reopened.readAgent("explore-1"))).toEqual([record(0), record(1)]);
  expect(await run(reopened.readAgent("absent"))).toBeUndefined();
  expect(Array.from(await run(reopened.readFile("files/0-0.png")))).toEqual(Array.from(data));
  expect(readdirSync(join(dir, "main")).sort()).toEqual(["2026-10-08.jsonl", "2026-10-09.jsonl"]);
  expect(readdirSync(dir).filter((s) => s.endsWith(".tmp"))).toEqual([]);
  expect(JSON.parse(readFileSync(join(dir, "view-batch.json"), "utf8"))).toEqual({ chat: true, compaction: false });
  await run(store.saveViews([], [], { chat: false, compaction: true }));
  expect((await run(reopened.load())).batch).toEqual({ chat: false, compaction: true });
  expect(readdirSync(dir).filter((s) => s.endsWith(".tmp"))).toEqual([]);
});

test("new store has no views and false pending flags", async () => {
  const store = await run(Store.open(temp()));
  expect(await run(store.load())).toEqual({ records: [], nodes: [], agents: new Map(),
    batch: { chat: false, compaction: false }, tornLines: [], view: undefined, compView: undefined, system: undefined });
});

test("append after a torn tail preserves it and reload reports it", async () => {
  const dir = temp();
  const store = await run(Store.open(dir));
  await run(store.appendRecord(record(0)));
  const path = join(dir, "main", "2026-10-09.jsonl");
  appendFileSync(path, '{"i":1');
  const loaded = await run(store.load());
  expect(loaded.records).toEqual([record(0)]);
  expect(loaded.tornLines).toEqual([{ path, line: 2 }]);
  const before = readFileSync(path, "utf8");
  await run(store.appendRecord(record(1)));
  await run(store.appendRecord(record(2)));
  expect(readFileSync(path, "utf8")).toBe(`${before}\n${JSON.stringify(record(1))}\n${JSON.stringify(record(2))}\n`);
  const reopened = await run(Store.open(dir));
  const result = await run(reopened.load());
  expect(result.records).toEqual([record(0), record(1), record(2)]);
  expect(result.tornLines).toEqual([{ path, line: 2 }]);
});

test("complete final record without newline is preserved on append", async () => {
  const dir = temp();
  const store = await run(Store.open(dir));
  writeFileSync(join(dir, "main", "2026-10-09.jsonl"), JSON.stringify(record(0)));
  await run(store.appendRecord(record(1)));
  expect((await run(store.load())).records).toEqual([record(0), record(1)]);
});

test("load reports torn tree and agent tails and rejects corrupt saved views", async () => {
  const dir = temp();
  const store = await run(Store.open(dir));
  const node = { l: 0, i: 0, text: "summary", size: 7 };
  await run(store.appendNode(node));
  await run(store.appendAgent("worker-1", record(0)));
  const treePath = join(dir, "tree", readdirSync(join(dir, "tree"))[0]);
  const agentPath = join(dir, "agents", "worker-1.jsonl");
  appendFileSync(treePath, '{"l":');
  appendFileSync(agentPath, '{"i":');
  const loaded = await run(store.load());
  expect(loaded.nodes).toEqual([node]);
  expect(loaded.agents.get("worker-1")).toEqual([record(0)]);
  expect(loaded.tornLines).toHaveLength(2);
  expect(loaded.tornLines).toEqual(expect.arrayContaining([{ path: treePath, line: 2 }, { path: agentPath, line: 2 }]));
  const nextNode = { ...node, i: 1 };
  await run(store.appendNode(nextNode));
  await run(store.appendAgent("worker-1", record(1)));
  const recovered = await run(store.load());
  expect(recovered.nodes).toEqual([node, nextNode]);
  expect(recovered.agents.get("worker-1")).toEqual([record(0), record(1)]);
  expect(recovered.tornLines).toEqual(loaded.tornLines);
  expect(await run(store.readAgent("worker-1"))).toEqual([record(0), record(1)]);
  writeFileSync(join(dir, "view.json"), "[[0,");
  const result = await run(Effect.result(store.load()));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure._tag).toBe("StoreError");
});

test("system replacement is saved, attachments cannot be overwritten, paths cannot escape", async () => {
  const store = await run(Store.open(temp()));
  await run(store.saveSystem("original"));
  await run(store.saveSystem("changed"));
  expect((await run(store.load())).system).toBe("changed");
  for (const name of ["", "..", "../escape", "a/b", "a\\b", "a\0b"]) {
    expect((await run(Effect.result(store.appendAgent(name, record(0)))))._tag).toBe("Failure");
    expect((await run(Effect.result(store.readAgent(name))))._tag).toBe("Failure");
    expect((await run(Effect.result(store.saveFile(name, new Uint8Array()))))._tag).toBe("Failure");
  }
  for (const rel of ["system.txt", "files/../system.txt", "files/a/b", "files/a\\b"]) {
    expect((await run(Effect.result(store.readFile(rel))))._tag).toBe("Failure");
  }
  await run(store.saveFile("attachment", new Uint8Array([1])));
  expect((await run(Effect.result(store.saveFile("attachment", new Uint8Array([2])))))._tag).toBe("Failure");
  expect(Array.from(await run(store.readFile("files/attachment")))).toEqual([1]);
});

test("duplicate nodes from ambiguous writes load once and the first text wins", async () => {
  const dir = temp();
  const store = await run(Store.open(dir));
  const first = { l: 0, i: 0, text: "first", size: 5 };
  await run(store.appendNode(first));
  await run(store.appendNode({ ...first, text: "later", size: 5 }));
  await run(store.appendNode({ l: 1, i: 0, text: "parent", size: 6 }));
  expect((await run((await run(Store.open(dir))).load())).nodes).toEqual([first, { l: 1, i: 0, text: "parent", size: 6 }]);
});
