// Seeds a UniiChat chat with your past OpenCode sessions, as UniiChat's /import does with Claude Code
// and Codex (Term.ts term_import, Import.ts): without --go it only says what it found and what
// summarizing it costs; with --go it sends them to the plugin, which logs them at the chat's end and
// builds their summaries on their own side (turns don't wait for them), and shows how far they are.
//
//   bun scripts/import.ts [--session ses_…] [--since YYYY-MM-DD] [--tools] [--exclude DIR]…
//                         [--skip ses_…]… [--only ses_…]… [--sessions] [--go] [--watch]
//                         [--pause | --resume] [--server URL]
//
// The chat is a session with UniiChat on (/unii on); a dry run (no --go) needs none. The plugin must be loaded by the OpenCode
// service the script talks to (the background one, or --server).

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { estimate, lineSize, sessionLines, type ImportLine, type SessionInfo } from "../src/importer.ts";
import type { Row } from "../src/history.ts";

// Import.ts DONE and OLD
const DONE = "Your past chats are in Unii's memory: ask about them any time.";
const OLD = "Nothing new: these chats are in Unii's memory already.";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, k) => (a === name && args[k + 1] ? [args[k + 1]!] : []));
const value = (name: string) => values(name).at(-1);
const expand = (path: string) => resolve(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path === "~" ? homedir() : path);
const short = (path: string) => path.replace(homedir(), "~");

const server = value("--server");
const want = { since: value("--since") ?? "", tools: flag("--tools") };
const excluded = values("--exclude").map(expand);
const skip = new Set(values("--skip"));
const only = new Set(values("--only"));

const scratch = join(tmpdir(), `uniichat-import-${process.pid}`);
mkdirSync(scratch, { recursive: true });
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** One request through `opencode api`, its output read from a file (a pipe can cut a large one short). */
const api = (method: string, path: string, body?: unknown): any => {
  const file = join(scratch, `${Math.random().toString(36).slice(2)}.json`);
  const fd = openSync(file, "w");
  const cli = ["api", ...(server ? ["--server", server] : []), method, path, ...(body === undefined ? [] : ["-d", JSON.stringify(body)])];
  const run = spawnSync("opencode", cli, { stdio: ["ignore", fd, "pipe"] });
  closeSync(fd);
  const text = readFileSync(file, "utf8");
  rmSync(file, { force: true });
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path}: ${text.slice(0, 300) || run.stderr.toString().slice(0, 300)}`);
  }
  if (run.status !== 0 || json?._tag || json?.error) throw new Error(`${method} ${path}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
};

/** Every page of a listing, following its cursor. */
const pages = (path: string, first: string) => {
  const out: any[] = [];
  let query = first;
  for (;;) {
    const page = api("get", `${path}?${query}`);
    out.push(...page.data);
    const next = page.cursor?.next;
    if (!next || page.data.length === 0) return out;
    query = `limit=200&cursor=${encodeURIComponent(next)}`;
  }
};

const day = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });

// The chat to seed; a dry run needs none.
const id = value("--session");
if (!id && (flag("--go") || flag("--watch") || flag("--pause") || flag("--resume"))) {
  throw new Error("--session ses_… names the chat to import into (a session with /unii on)");
}
const target = id === undefined ? undefined : api("get", `/api/session/${id}`).data as SessionInfo;
if (target?.parentID) throw new Error(`${target.id} is a subagent's session`);
const rpc = (method: string, input: Record<string, unknown>) =>
  api("post", `/api/rpc/uniichat/${method}?location[directory]=${encodeURIComponent(target!.location.directory)}`, { input: { sessionID: target!.id, ...input } }).output;

const watch = async () => {
  let last = "";
  for (;;) {
    const s = rpc("importStatus", {});
    if (s === null) return console.log(DONE);
    const line = `summaries ${s.built.toLocaleString()}/${s.total.toLocaleString()}, calls running ${s.running}${s.paused ? ", paused (--resume goes on)" : ""}`;
    if (line !== last) console.log(`${new Date().toLocaleTimeString("sv-SE")} ${line}`);
    last = line;
    await new Promise((r) => setTimeout(r, 10_000));
  }
};

if (flag("--pause") || flag("--resume")) {
  rpc("importPause", { paused: flag("--pause") });
  console.log(flag("--pause") ? "Paused: no summary of the import starts; those running end." : "Resumed.");
  process.exit(0);
}
if (flag("--watch") && !flag("--go")) {
  await watch();
  process.exit(0);
}

// The sessions to import: every top-level one but the chat's, oldest first.
console.log("Looking for OpenCode sessions…");
const all = pages("/api/session", "limit=200") as SessionInfo[];
const ids = new Set(all.map((s) => s.id));
const left = (s: SessionInfo) =>
  s.parentID !== undefined || s.id === target?.id || skip.has(s.id) || (only.size > 0 && !only.has(s.id)) ||
  excluded.some((d) => s.location.directory === d || s.location.directory.startsWith(`${d}/`));
const roots = all.filter((s) => !left(s));
const kept = new Set(roots.map((s) => s.id));

type Found = { session: SessionInfo; lines: ImportLine[] };
const found: Found[] = [];
let read = 0;
for (const session of roots) {
  const rows = pages(`/api/session/${session.id}/message`, "limit=200&order=asc") as Row[];
  // A fork's copy of its parent's history comes with the parent, when that is imported too.
  const parentKept = session.fork ? kept.has(session.fork.sessionID) && ids.has(session.fork.sessionID) : false;
  const lines = sessionLines(session, rows, want, parentKept);
  if (lines.length > 0) found.push({ session, lines });
  if (++read % 50 === 0) console.log(`  read ${read}/${roots.length} sessions`);
}
found.sort((a, b) => a.lines[0]!.date.localeCompare(b.lines[0]!.date));

const lines = found.flatMap((f) => f.lines);
const kinds = new Map<string, number>();
for (const line of lines) kinds.set(line.kind, (kinds.get(line.kind) ?? 0) + 1);
// Imports go at the chat's end, so the estimate starts at its count.
const count = target === undefined ? 0 : (rpc("status", {}).chat?.T as number | undefined) ?? 0;
const cost = estimate(count, lines.map(lineSize));
const mb = lines.reduce((n, l) => n + lineSize(l), 0) / 1e6;

console.log(`\nFound ${found.length} sessions with ${(lines.length - found.length).toLocaleString()} messages (${mb.toFixed(1)} MB; any already in the chat are skipped), from ${found[0] ? day(found[0].lines[0]!.date) : "-"}.`);
console.log(`  by kind: ${[...kinds].map(([k, n]) => `${k} ${n.toLocaleString()}`).join(", ")}`);
console.log(`  ${want.tools ? "with" : "without"} tool calls and results${want.since ? `, from ${want.since}` : ""}`);
console.log(`Summarizing them takes about ${cost.calls.toLocaleString()} model calls, costing about $${Math.max(0.01, cost.usd).toFixed(2)} (UniiChat's price model for its compactor, Haiku 5.5 at high effort).`);
console.log(`  ${cost.leaves.toLocaleString()} of those summarize a message, the plugin's import.leaves at once (UniiChat: 64); the rest merge lines, compaction.concurrency at once.`);
if (flag("--sessions")) {
  found.forEach((f, k) => console.log(`  #${k + 1} ${f.session.id} · ${day(f.lines[0]!.date)} · ${f.lines.length - 1} · ${short(f.session.location.directory)} · ${f.session.title ?? ""}`));
}
if (!flag("--go")) {
  console.log("\nNothing was imported. Add --go to import them.");
  process.exit(0);
}
if (lines.length === 0) {
  console.log(OLD);
  process.exit(0);
}

const dir = join(homedir(), ".local", "share", "opencode", "uniichat", "imports");
mkdirSync(dir, { recursive: true });
const body = join(dir, `${target!.id}-${Date.now()}.jsonl`);
writeFileSync(body, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
const started = rpc("import", { file: body });
if (started.logged === 0) {
  console.log(OLD);
  process.exit(0);
}
console.log(`Logged ${started.logged.toLocaleString()} new messages (${started.a}–${started.b - 1}) into ${target!.id}.`);
console.log("Meanwhile, UniiChat can answer with a partial tree. Ctrl-C stops only this watch:");
console.log(`  bun scripts/import.ts --session ${target!.id} --watch${server ? ` --server ${server}` : ""}`);
await watch();
