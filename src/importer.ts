// Past OpenCode sessions read into a chat, as UniiChat's Import.ts reads Claude Code and Codex logs:
// each session a note, then its messages, oldest session first; never thinking, OpenCode's own
// compaction summaries, its injected prompts, skills' instructions or subagents' chats. Without
// `tools`, only the user's words and the AI's replies; their files as names. The estimate is
// Import.ts's (import_guess), on UniiChat's own measured prices for its compactor.

import { items, type Item, type Row } from "./history.ts";
import { fileLine, shownKind, utf8Size, type Kind } from "./record.ts";

/** A message as an import's body holds it: one JSON line. */
export interface ImportLine {
  kind: Kind;
  text: string;
  date: string;
  src: string;
}

/** The subset of OpenCode's session info an import reads. */
export interface SessionInfo {
  id: string;
  title?: string;
  parentID?: string;
  fork?: { sessionID: string };
  time: { created: number };
  location: { directory: string };
}

/** What an import takes: messages from a day on ("": all), tool calls and their results or not. */
export interface Want {
  since: string;
  tools: boolean;
}

const KINDS: Kind[] = ["user", "unii", "tool", "echo", "note"];

const created = (row: Row) => Number(row.time.created);

/** A session as it opens (Import.ts import_name): the app, where, when (local time), its title. */
export function noteText(s: SessionInfo, start: string) {
  const when = new Date(start).toLocaleString("sv-SE").slice(0, 16);
  const title = s.title ? ` "${s.title}"` : "";
  return `OpenCode session${title} in ${s.location.directory}, from ${when} (imported)`;
}

/**
 * A session's messages as import lines, its note first; none if nothing is kept. A fork's copy of
 * its parent's history is skipped when the parent is imported too (`parentKept`): the copy has new
 * ids but the old times.
 */
export function sessionLines(s: SessionInfo, rows: readonly Row[], want: Want, parentKept: boolean): ImportLine[] {
  const own = s.fork && parentKept ? rows.filter((row) => created(row) >= s.time.created) : rows;
  // What the user said and the AI answered; a skill row is its instructions, a shell row the user's command.
  const said = own.filter((row) => row.type === "user" || row.type === "assistant" || want.tools && (row.type === "shell" ||
    row.type === "synthetic" && row.metadata?.source === "subagent"))
    // Files come as names only: an import carries no attachment's bytes.
    .map((row) => row.type === "user" && row.files ? { ...row, files: row.files.map((file) => ({ ...file, data: "" })) } : row);
  const keep = (item: Item) => item.kind === "user" || item.kind === "unii" || want.tools && (item.kind === "tool" || item.kind === "echo" || item.kind === "work");
  const lines = items(said, { name: () => "agent" }).filter(keep).flatMap((item): ImportLine[] => {
    const date = new Date(item.date).toISOString();
    if (date.slice(0, 10) < want.since) return [];
    const files = (item.files ?? []).map((file) => fileLine(file.name, file.mime));
    const text = [item.text, ...files].filter((part) => part !== "").join("\n");
    if (text.trim() === "") return [];
    // A past subagent's report is a tool result here: its chat is not this chat's to zoom.
    const kind: Kind = item.kind === "work" ? "echo" : item.kind;
    return [{ kind, text, date, src: `import:${s.id}:${item.src}` }];
  });
  if (lines.length === 0) return [];
  return [{ kind: "note", text: noteText(s, lines[0]!.date), date: lines[0]!.date, src: `import:${s.id}` }, ...lines];
}

/** An import line read back, as a message to log; a string says why it is none (the import is refused whole). */
export function readLine(x: unknown): Item | string {
  const line = x as Partial<ImportLine> | null;
  if (!line || !KINDS.includes(line.kind as Kind)) return `An import line has no kind ${String(line?.kind)}.`;
  if (typeof line.text !== "string") return `An import has a ${line.kind} message with no text.`;
  if (typeof line.src !== "string" || !line.src.startsWith("import:")) return `An import has a ${line.kind} message with no import src.`;
  const date = Date.parse(String(line.date));
  return { kind: line.kind!, text: line.text, date: Number.isNaN(date) ? Date.now() : date, src: line.src };
}

/** A message's bytes as summarized (Import.ts import_size): its AI reads as ai. */
export const lineSize = (line: ImportLine) => utf8Size(`${shownKind({ kind: line.kind, imported: true })}: ${line.text}`);

// Import.ts: a summary's bytes (the compactor writes 460-510), and what a compaction call costs on
// the compactor, in micro-USD: base, `byte` a doubling of its source past NODE, `depth` a summary
// under it; fit on 5,617 compaction calls of real imports.
const NODE = 512;
const LINE = 480;
const PRICE = { base: 187, byte: 735, depth: 628 };
type Node = { bytes: number; depth: number };
const nodeUSD = (node: Node) => node.bytes <= NODE ? 0 : Math.round(PRICE.base + PRICE.byte * Math.log2(node.bytes / NODE) + PRICE.depth * (node.depth + 1));
const nodeLine = (node: Node): Node => node.bytes > NODE ? { bytes: LINE, depth: node.depth + 1 } : { bytes: node.bytes, depth: 0 };
const nodeMerge = (a: Node, b: Node): Node => ({ bytes: a.bytes + 1 + b.bytes, depth: Math.max(a.depth, b.depth) });

/**
 * What summarizing messages of these sizes, appended to a chat of `a` messages, takes (import_guess):
 * USD, model calls, and how many of those summarize a message (`leaves`) rather than merge lines.
 */
export function estimate(a: number, sizes: readonly number[]) {
  let usd = 0;
  let calls = 0;
  const leaves = sizes.filter((b) => b > NODE).length;
  let nodes: Node[] = sizes.map((bytes) => ({ bytes, depth: 0 }));
  for (let l = 0, i = a; nodes.length > 0; l++, i = Math.floor(i / 2)) {
    for (const node of nodes) {
      const cost = nodeUSD(node);
      usd += cost;
      if (cost > 0) calls++;
    }
    const line = (k: number) => (k < 0 ? { bytes: LINE, depth: l } : nodeLine(nodes[k]!));
    const from = Math.floor(i / 2);
    nodes = Array.from({ length: Math.floor((i + nodes.length) / 2) - from }, (_, j) => nodeMerge(line(2 * (from + j) - i), line(2 * (from + j) + 1 - i)));
  }
  return { usd: usd / 1e6, calls, leaves };
}
