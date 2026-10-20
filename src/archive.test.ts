import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Archive } from "./archive.ts";
import { Store } from "./store.ts";
import { page } from "./record.ts";

const run = Effect.runPromise;
const record = (i: number, text = `message ${i}`) => ({ i, kind: "user" as const, text, size: Buffer.byteLength(text), date: "2026-10-20T12:00:00", src: `msg_${i}:0` });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "uniichat-index-"));
  const store = await run(Store.open(dir));
  return { dir, store };
}

test("legacy JSONL builds a bounded address/source index; reopen catches the durable crash tail", async () => {
  const { dir } = await fixture();
  const count = 6000;
  writeFileSync(join(dir, "main/2026-10-20.jsonl"), Array.from({ length: count }, (_, i) => JSON.stringify(record(i))).join("\n") + "\n");
  writeFileSync(join(dir, "tree/2026-10-20.jsonl"), Array.from({ length: count }, (_, i) => JSON.stringify({ l: 0, i, text: `summary ${i}` })).join("\n") + "\n");
  const archive = new Archive(dir);
  try {
    expect(archive.count()).toBe(count);
    expect(archive.source("msg_5000:0")).toBe(5000);
    expect(archive.hasBase("msg_5999")).toBe(true);
    expect(archive.record(3333)?.text).toBe("message 3333");
    expect(archive.missing(0, 64)).toEqual([]);
    expect(archive.ready(4, 10)).toEqual([[1, 0], [1, 1]]);
    for (let i = 0; i < count; i++) expect(archive.node(0, i)).toBe(`summary ${i}`);
    expect(archive.stats().cachedNodes).toBeLessThanOrEqual(4096);
    expect(archive.stats().cachedChars).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(archive.stats().openFiles).toBeLessThanOrEqual(8);
  } finally { archive.close(); }
  appendFileSync(join(dir, "main/2026-10-20.jsonl"), JSON.stringify(record(count)) + "\n");
  const reopened = new Archive(dir);
  try {
    expect(reopened.count()).toBe(count + 1);
    expect(reopened.missing(0, 64)).toEqual([count]);
    expect(reopened.record(count)?.text).toBe(`message ${count}`);
  } finally { reopened.close(); }
});

test("a corrupt derived index is rebuilt from authoritative JSONL", async () => {
  const { dir, store } = await fixture();
  await run(store.appendRecord(record(0)));
  writeFileSync(join(dir, "archive.index.sqlite"), "damaged disposable index");
  const archive = new Archive(dir);
  try { expect(archive.record(0)?.text).toBe("message 0"); } finally { archive.close(); }
});

test("malformed view snapshots recover the highest built cut", async () => {
  const { dir, store } = await fixture();
  for (let i = 0; i < 2; i++) {
    await run(store.appendRecord(record(i)));
    await run(store.appendNode({ l: 0, i, text: `leaf ${i}`, size: 6 }));
  }
  await run(store.appendNode({ l: 1, i: 0, text: "saved pair", size: 10 }));
  writeFileSync(join(dir, "view.json"), "{broken");
  writeFileSync(join(dir, "compaction-view.json"), "{}");
  const { Chat } = await import("./chat.ts");
  const chat = await run(Chat.open(dir, { compact: () => Effect.die("no model needed") }));
  try {
    expect(chat.renderView().tail).toBe("0+2|saved pair\n</chat>\n");
    expect(chat.status().pending).toBe(0);
  } finally { await run(chat.close()); }
});

test("indexed appends survive a torn tail and preserve first durable node on duplicate writes", async () => {
  const { dir, store } = await fixture();
  await run(store.appendRecord(record(0)));
  appendFileSync(join(dir, "main/2026-10-20.jsonl"), '{"i":1');
  const { archive } = await run(store.indexed());
  try {
    await run(store.appendRecord(record(1)));
    expect(archive.record(1)?.text).toBe("message 1");
    await run(store.appendNode({ l: 0, i: 0, text: "first", size: 5 }));
    await run(store.appendNode({ l: 0, i: 0, text: "duplicate", size: 9 }));
    expect(archive.node(0, 0)).toBe("first");
  } finally { store.close(); }
});

test("indexed agent paging matches whole-text paging, including newlines and literal markers", async () => {
  const { dir, store } = await fixture();
  const { archive } = await run(store.indexed());
  const name = archive.agentName("child", "explore");
  const texts = ["hello\n[characters literal]", "猫🙂".repeat(12000), "tail"];
  for (const [i, text] of texts.entries()) await run(store.appendAgent(name, { ...record(i, text), src: `child:msg_${i}:0` }));
  const full = texts.map((text, i) => `${i}|user: ${text}`).join("\n\n");
  try {
    for (const at of [0, 13, 30000, 31000, full.length, full.length + 50]) expect(archive.agentPage(name, at)).toBe(page(full, at));
  } finally { store.close(); }
  rmSync(join(dir, "archive.index.sqlite"));
  const rebuilt = new Archive(dir);
  try { expect(rebuilt.agentName("child", "other")).toBe(name); } finally { rebuilt.close(); }
});
