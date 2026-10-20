import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { join } from "node:path";
import type { LogRecord } from "./record.ts";
import { pageEnd, PAGE } from "./record.ts";
import type { Ref } from "./tree.ts";

type Place = { path: string; at: number; length: number };
type FileState = { size: number; mtime: number; ino: number };
const LIMIT = 4096;
const CACHE_CHARS = 2 * 1024 * 1024;

/** At most one JSONL record plus a read buffer is retained. */
export function* lines(file: string, from = 0): Generator<{ data: Buffer; at: number }> {
  const fd = fs.openSync(file, "r"), buf = Buffer.alloc(256 * 1024);
  let carry = Buffer.alloc(0), at = from, start = from;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, at);
      if (!n) break;
      at += n;
      const data = Buffer.concat([carry, buf.subarray(0, n)]);
      let offset = 0;
      for (let nl = data.indexOf(10); nl >= 0; nl = data.indexOf(10, offset)) {
        yield { data: data.subarray(offset, nl), at: start + offset };
        offset = nl + 1;
      }
      carry = Buffer.from(data.subarray(offset)); start += offset;
    }
    if (carry.length) yield { data: carry, at: start };
  } finally { fs.closeSync(fd); }
}

/** Disposable SQLite address/source index. JSONL remains the only authoritative history.
 * Scanning and reads are bounded; neither messages nor all node texts are loaded into JS.
 */
export class Archive {
  private readonly db: Database;
  private readonly fds = new Map<string, number>();
  private readonly cache = new Map<string, string>();
  private cacheChars = 0;
  private closed = false;
  constructor(readonly dir: string) {
    const file = join(dir, "archive.index.sqlite");
    const open = () => {
      const db = new Database(file, { create: true });
      try { db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, size INTEGER, mtime REAL, ino INTEGER);
        CREATE TABLE IF NOT EXISTS records(scope TEXT, i INTEGER, src TEXT, base TEXT, path TEXT, at INTEGER, length INTEGER, chars INTEGER, PRIMARY KEY(scope,i));
        CREATE INDEX IF NOT EXISTS sources ON records(scope,src);
        CREATE INDEX IF NOT EXISTS bases ON records(scope,base);
        CREATE TABLE IF NOT EXISTS nodes(l INTEGER, i INTEGER, end INTEGER, path TEXT, at INTEGER, length INTEGER, PRIMARY KEY(l,i));
        CREATE INDEX IF NOT EXISTS ends ON nodes(end,l);
        CREATE TABLE IF NOT EXISTS ready(l INTEGER, i INTEGER, end INTEGER, PRIMARY KEY(l,i));
        CREATE INDEX IF NOT EXISTS ready_order ON ready(end,l DESC);
        CREATE TABLE IF NOT EXISTS agents(child TEXT PRIMARY KEY, name TEXT UNIQUE);`); }
      catch (error) { db.close(); throw error; }
      return db;
    };
    try { this.db = open(); } catch (error) {
      if (!["SQLITE_NOTADB", "SQLITE_CORRUPT"].includes((error as { code?: string }).code ?? "")) throw error;
      fs.rmSync(file, { force: true });
      this.db = open();
    }
    try { this.refresh(); } catch (error) { this.close(); throw error; }
  }
  private read<A>(p: Place | null): A | undefined {
    if (!p) return;
    let fd = this.fds.get(p.path);
    if (fd === undefined) fd = fs.openSync(join(this.dir, p.path), "r");
    this.fds.delete(p.path); this.fds.set(p.path, fd);
    while (this.fds.size > 8) {
      const [name, old] = this.fds.entries().next().value!;
      fs.closeSync(old); this.fds.delete(name);
    }
    const data = Buffer.alloc(p.length);
    let got = 0;
    while (got < data.length) {
      const n = fs.readSync(fd, data, got, data.length - got, p.at + got);
      if (!n) throw new Error(`Truncated archive record in ${p.path}`);
      got += n;
    }
    return JSON.parse(data.toString("utf8")) as A;
  }
  private index(path: string, at: number, length: number, value: any) {
    if (!value || typeof value !== "object") return;
    if (path.startsWith("tree/")) {
      if (!Number.isSafeInteger(value.l) || value.l < 0 || value.l > 52 || !Number.isSafeInteger(value.i) || value.i < 0 ||
          !Number.isSafeInteger((value.i + 1) * 2 ** value.l) || typeof value.text !== "string") return;
      this.db.query("INSERT OR IGNORE INTO nodes VALUES (?,?,?,?,?,?)").run(value.l, value.i, (value.i + 1) * 2 ** value.l, path, at, length);
      this.db.query("DELETE FROM ready WHERE l=? AND i=?").run(value.l, value.i);
      const l = value.l + 1, i = Math.floor(value.i / 2);
      if (this.has([value.l, value.i % 2 === 0 ? value.i + 1 : value.i - 1]) && !this.has([l, i])) {
        this.db.query("INSERT OR IGNORE INTO ready VALUES (?,?,?)").run(l, i, (i + 1) * 2 ** l);
      }
      return;
    }
    if (!Number.isSafeInteger(value.i) || value.i < 0 || typeof value.src !== "string" || typeof value.text !== "string") return;
    const scope = path.startsWith("main/") ? "main" : `agent:${path.slice(7, -6)}`;
    this.db.query("INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?,?)").run(scope, value.i, value.src, value.src.split(":")[0], path, at, length, `${value.i}|${value.kind}: ${value.text}\n\n`.length);
    if (scope !== "main" && value.i === 0) this.db.query("INSERT OR IGNORE INTO agents VALUES (?,?)").run(value.src.split(":")[0], scope.slice(6));
  }
  /** Rescan changed tails; rewrites invalidate their addresses. A torn line is ignored. */
  refresh() {
    this.cache.clear();
    this.cacheChars = 0;
    for (const fd of this.fds.values()) fs.closeSync(fd);
    this.fds.clear();
    const paths = ["main", "tree", "agents"].flatMap((sub) => fs.readdirSync(join(this.dir, sub)).filter((f) => f.endsWith(".jsonl")).sort().map((f) => `${sub}/${f}`));
    const present = new Set(paths);
    this.db.transaction(() => {
      const rewritten = (this.db.query("SELECT path,size,mtime,ino FROM files").all() as (FileState & { path: string })[]).some((saved) => {
        if (!present.has(saved.path)) return true;
        const stat = fs.statSync(join(this.dir, saved.path));
        return saved.ino !== stat.ino || saved.size > stat.size || saved.size === stat.size && saved.mtime !== stat.mtimeMs;
      });
      if (rewritten) this.db.exec("DELETE FROM records; DELETE FROM nodes; DELETE FROM files; DELETE FROM ready;");
      for (const path of paths) this.scan(path);
      // Also upgrades an older derived index which has no ready table yet.
      this.db.exec(`DELETE FROM ready; INSERT INTO ready SELECT a.l+1,a.i/2,b.end FROM nodes a
        JOIN nodes b ON b.l=a.l AND b.i=a.i+1 LEFT JOIN nodes p ON p.l=a.l+1 AND p.i=a.i/2
        WHERE a.i%2=0 AND p.i IS NULL;`);
    })();
  }
  private forget(path: string) {
    this.db.query("DELETE FROM records WHERE path=?").run(path);
    this.db.query("DELETE FROM nodes WHERE path=?").run(path);
    this.db.query("DELETE FROM files WHERE path=?").run(path);
  }
  private scan(path: string) {
    const file = join(this.dir, path), stat = fs.statSync(file);
    const saved = this.db.query("SELECT size,mtime,ino FROM files WHERE path=?").get(path) as FileState | null;
    if (saved && saved.size === stat.size && saved.mtime === stat.mtimeMs && saved.ino === stat.ino) return;
    let at = saved && saved.ino === stat.ino && saved.size < stat.size ? saved.size : 0;
    if (!at) this.forget(path);
    const parse = (data: Buffer, offset: number) => {
      let value: unknown;
      try { value = JSON.parse(data.toString("utf8")); } catch { return; }
      this.index(path, offset, data.length, value);
    };
    for (const line of lines(file, at)) parse(line.data, line.at);
    this.db.query("INSERT OR REPLACE INTO files VALUES (?,?,?,?)").run(path, stat.size, stat.mtimeMs, stat.ino);
  }
  /** Called only after the JSONL append has been flushed successfully. */
  appended(path: string) { this.db.transaction(() => this.scan(path))(); }
  record(i: number, scope = "main") { return this.read<LogRecord>(this.db.query("SELECT path,at,length FROM records WHERE scope=? AND i=?").get(scope, i) as Place | null); }
  node(l: number, i: number) {
    const key = `${l}:${i}`, cached = this.cache.get(key);
    if (cached !== undefined) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const value = this.read<{ text: string }>(this.db.query("SELECT path,at,length FROM nodes WHERE l=? AND i=?").get(l, i) as Place | null)?.text;
    if (value !== undefined && value.length <= CACHE_CHARS) {
      this.cache.set(key, value);
      this.cacheChars += value.length;
      while (this.cache.size > LIMIT || this.cacheChars > CACHE_CHARS) {
        const [old, text] = this.cache.entries().next().value!;
        this.cacheChars -= text.length;
        this.cache.delete(old);
      }
    }
    return value;
  }
  has([l, i]: Ref) { return this.db.query("SELECT 1 FROM nodes WHERE l=? AND i=?").get(l, i) !== null; }
  count(scope = "main") { return (this.db.query("SELECT COALESCE(MAX(i)+1,0) AS n FROM records WHERE scope=?").get(scope) as { n: number }).n; }
  source(src: string, scope = "main") { return (this.db.query("SELECT i FROM records WHERE scope=? AND src=? ORDER BY i LIMIT 1").get(scope, src) as { i: number } | null)?.i; }
  hasBase(base: string) { return this.db.query("SELECT 1 FROM records WHERE scope='main' AND base=? LIMIT 1").get(base) !== null; }
  missing(from: number, limit: number): number[] {
    return (this.db.query("SELECT r.i FROM records r LEFT JOIN nodes n ON n.l=0 AND n.i=r.i WHERE r.scope='main' AND r.i>=? AND n.i IS NULL ORDER BY r.i LIMIT ?").all(from, limit) as { i: number }[]).map((r) => r.i);
  }
  ready(end: number, limit: number): Ref[] {
    return (this.db.query("SELECT l,i FROM ready WHERE end<=? ORDER BY end,l DESC LIMIT ?").all(end, limit) as { l: number; i: number }[]).map(({ l, i }) => [l, i]);
  }
  pending() { return (this.db.query("SELECT COUNT(*) AS n FROM records r LEFT JOIN nodes n ON n.l=0 AND n.i=r.i WHERE r.scope='main' AND n.i IS NULL").get() as { n: number }).n; }
  agentName(child: string, type: string) {
    const existing = this.db.query("SELECT name FROM agents WHERE child=?").get(child) as { name: string } | null;
    if (existing) return existing.name;
    const prefix = type.replace(/[^A-Za-z0-9_-]/g, "-") || "agent";
    let n = 1;
    while (this.db.query("SELECT 1 FROM agents WHERE name=?").get(`${prefix}-${n}`)) n++;
    const name = `${prefix}-${n}`;
    this.db.query("INSERT INTO agents VALUES (?,?)").run(child, name);
    return name;
  }
  agentExists(name: string) { return this.db.query("SELECT 1 FROM agents WHERE name=?").get(name) !== null; }
  agentPage(name: string, at: number) {
    const scope = `agent:${name}`;
    const total = Math.max(0, (this.db.query("SELECT COALESCE(SUM(chars),0) AS n FROM records WHERE scope=?").get(scope) as { n: number }).n - 2);
    const from = Math.min(at, total);
    let offset = 0, text = "";
    const rows = this.db.prepare("SELECT i,chars FROM records WHERE scope=? ORDER BY i");
    try {
      for (const row of rows.iterate(scope) as Iterable<{ i: number; chars: number }>) {
        if (offset + row.chars > from) {
          const rec = this.record(row.i, scope)!;
          text += `${rec.i}|${rec.kind}: ${rec.text}\n\n`.slice(Math.max(0, from - offset));
          if (text.length > PAGE) break;
        }
        offset += row.chars;
      }
    } finally { rows.finalize(); }
    text = text.slice(0, total - from);
    // Use the same boundary as a full string, without materializing that string.
    const body = text.slice(0, pageEnd(text, 0));
    const end = from + body.length;
    return body + (end < total ? `\n[characters ${from + 1}-${end} of ${total}; go on with at ${end}]` : "");
  }
  stats() { return { cachedNodes: this.cache.size, cachedChars: this.cacheChars, openFiles: this.fds.size }; }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fd of this.fds.values()) fs.closeSync(fd);
    this.fds.clear(); this.cache.clear(); this.cacheChars = 0; this.db.close();
  }
}
