export type Kind = "user" | "unii" | "tool" | "echo" | "work" | "note";

export interface LogRecord {
  i: number;
  kind: Kind;
  text: string;
  size: number;
  date: string;
  src: string;
}

export function utf8Size(s: string) {
  return new TextEncoder().encode(s).length;
}

export function cutUtf8(s: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("bytes must be a non-negative integer");
  let end = 0;
  let size = 0;
  for (const ch of s) {
    size += utf8Size(ch);
    if (size > bytes) break;
    end += ch.length;
  }
  return s.slice(0, end);
}

export function splitText(text: string, limit = 30000): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  if (text.length <= limit) return [text];
  const result: string[] = [];
  while (text.length > limit) {
    let end = limit;
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    const nl = text.lastIndexOf("\n", end - 1);
    if (nl >= 0) end = nl + 1;
    if (end === 0) throw new RangeError("limit cannot hold a surrogate pair");
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  result.push(text);
  return result;
}

function safeSlice(s: string, start: number, end: number) {
  if (start > 0 && /[\uD800-\uDBFF]/.test(s[start - 1]) && /[\uDC00-\uDFFF]/.test(s[start])) start++;
  if (end < s.length && /[\uD800-\uDBFF]/.test(s[end - 1]) && /[\uDC00-\uDFFF]/.test(s[end])) end--;
  return s.slice(start, end);
}

export function clipEcho(text: string) {
  if (text.length <= 30000) return text;
  const head = safeSlice(text, 0, 15000);
  const tail = safeSlice(text, text.length - 15000, text.length);
  const clipped = text.length - head.length - tail.length;
  return `${head}\n[… ${clipped} characters clipped …]\n${tail}`;
}

export const userSrc = (id: string, split: number) => `${id}:${split}`;
export const syntheticSrc = userSrc;
export const assistantSrc = (id: string, contentIndex: number, split: number) => `${id}:${contentIndex}:${split}`;
export const toolCallSrc = (id: string, split: number) => `${id}:call:${split}`;
export const toolResultSrc = (id: string) => `${id}:result`;
export const workSrc = (id: string, split = 0) => `${id}:${split}`;
export const toolText = (name: string, input: unknown) => `${name} ${JSON.stringify(input)}`;
export const echoText = (text: string, isError: boolean) => isError ? `error: ${text}` : text;
export const fileLine = (name: string, mime: string, path?: string) => path === undefined
  ? `[file: ${name} ${mime}, not available]`
  : `[file: ${name} ${mime} → ${path}]`;
export const formatISODate = (ms: number) => new Date(ms).toISOString();

export function formatDate(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  return `${date} ${time} ${zone} (${weekday})`;
}
