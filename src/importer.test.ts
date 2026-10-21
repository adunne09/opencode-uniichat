import { expect, test } from "bun:test";
import type { Row } from "./history.ts";
import { estimate, lineSize, noteText, readLine, sessionLines, type SessionInfo } from "./importer.ts";

const session: SessionInfo = { id: "ses_past", title: "Fix the build", time: { created: Date.parse("2026-08-03T10:12:00Z") }, location: { directory: "/work" } };
const at = (minute: number) => ({ created: Date.parse(`2026-08-03T10:${String(12 + minute).padStart(2, "0")}:00Z`) });
const model = { id: "model", providerID: "anthropic" };
const rows: Row[] = [
  { type: "user", id: "msg_u", text: "why does it fail?", files: [{ name: "log.txt", mime: "text/plain", data: "aGk=", source: { type: "inline" } } as never], time: at(0) },
  { type: "assistant", id: "msg_a", agent: "build", model, content: [
    { type: "reasoning", text: "thinking" } as never,
    { type: "text", text: "Let me look." },
    { type: "tool", id: "call_1", name: "read", state: { status: "completed", input: { path: "a" }, content: [{ type: "text", text: "file a" }] }, time: { created: at(1).created, completed: at(1).created } } as never,
    { type: "text", text: "It fails on a." },
  ], time: at(1) },
  { type: "skill", id: "msg_s", skill: "s", name: "s", text: "the skill's whole instructions", time: at(2) },
  { type: "synthetic", id: "msg_cont", text: "Continue if you have next steps", time: at(2) },
  { type: "compaction", id: "msg_cp", status: "completed", reason: "auto", summary: "a summary", time: at(3) } as never,
  { type: "user", id: "msg_u2", text: "thanks", time: at(4) },
];

test("a session reads as its note, then the user's words and the AI's replies only", () => {
  const lines = sessionLines(session, rows, { since: "", tools: false }, false);
  expect(lines.map((line) => [line.kind, line.text])).toEqual([
    ["note", noteText(session, lines[0]!.date)],
    ["user", "why does it fail?\n[file: log.txt text/plain, not available]"],
    ["unii", "Let me look."],
    ["unii", "It fails on a."],
    ["user", "thanks"],
  ]);
  expect(lines[0]!.text).toStartWith('OpenCode session "Fix the build" in /work, from 2026-08-03 ');
  expect(lines[0]!.text).toEndWith("(imported)");
  expect(lines.every((line) => line.src.startsWith("import:ses_past"))).toBe(true);
  expect(new Set(lines.map((line) => line.src)).size).toBe(lines.length);
});

test("tools bring calls and results; since and forks leave out what came before", () => {
  const tools = sessionLines(session, rows, { since: "", tools: true }, false);
  expect(tools.map((line) => line.kind)).toEqual(["note", "user", "unii", "tool", "unii", "echo", "user"]);
  expect(sessionLines(session, rows, { since: "2026-08-04", tools: false }, false)).toEqual([]);
  const fork = { ...session, fork: { sessionID: "ses_parent" }, time: { created: at(4).created } };
  expect(sessionLines(fork, rows, { since: "", tools: false }, true).map((line) => line.text.split("\n")[0])).toEqual([expect.stringContaining("OpenCode session"), "thanks"]);
});

test("lines read back as imported messages; a bad line refuses the import", () => {
  const [note, user] = sessionLines(session, rows, { since: "", tools: false }, false);
  expect(readLine(JSON.parse(JSON.stringify(user)))).toEqual({ kind: "user", text: user!.text, date: Date.parse(user!.date), src: user!.src });
  expect(readLine({ kind: "ai", text: "x", src: "import:x" })).toContain("no kind");
  expect(readLine({ kind: "user", text: "x", src: "msg_x" })).toContain("no import src");
  expect(lineSize({ ...note!, kind: "unii", text: "hi" })).toBe("ai: hi".length);
});

test("the estimate is UniiChat's: no call for a node that fits, one per larger node", () => {
  expect(estimate(0, [100, 100])).toEqual({ usd: 0, calls: 0, leaves: 0 });
  const big = estimate(0, [2000, 2000]);
  expect(big.leaves).toBe(2);
  expect(big.calls).toBe(3);
  expect(big.usd).toBeGreaterThan(0);
});
