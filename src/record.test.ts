import { describe, expect, test } from "bun:test";
import { clipEcho, cutUtf8, echoText, fileLine, formatDate, formatISODate, splitText, toolText, utf8Size } from "./record.ts";

describe("record text", () => {
  test("measures and cuts UTF-8 without splitting code points", () => {
    expect(utf8Size("aé中😀")).toBe(10);
    const prefixes = ["", "a", "a", "aé", "aé", "aé", "aé中", "aé中", "aé中", "aé中", "aé中😀"];
    for (let n = 0; n <= 10; n++) expect(cutUtf8("aé中😀", n)).toBe(prefixes[n]!);
    expect(cutUtf8("hello", 50)).toBe("hello");
    expect(cutUtf8("", 0)).toBe("");
    for (const n of [-1, 0.5, NaN, Infinity]) expect(() => cutUtf8("x", n)).toThrow(RangeError);
    expect(cutUtf8("x".repeat(100000), 100000)).toHaveLength(100000);
  });
  test("splits after the last newline before the UTF-16 limit", () => {
    expect(splitText("ab\ncd", 3)).toEqual(["ab\n", "cd"]);
    expect(splitText("a\nb\ncde", 5)).toEqual(["a\nb\n", "cde"]);
    expect(splitText("abc\ndef", 3)).toEqual(["abc", "\n", "def"]);
    expect(splitText("a😀b", 2)).toEqual(["a", "😀", "b"]);
    expect(splitText("", 3)).toEqual([""]);
    expect(splitText("abc", 3)).toEqual(["abc"]);
    for (const limit of [0, -1, 1.5, NaN, Infinity]) expect(() => splitText("x", limit)).toThrow(RangeError);
    expect(() => splitText("😀", 1)).toThrow(RangeError);
  });
  test("pages all text without loss, oversize pages or broken pairs", () => {
    for (const text of ["x".repeat(60001), "x".repeat(29999) + "😀" + "y".repeat(30000), "é中😀\n".repeat(10000)]) {
      const pages = splitText(text);
      expect(pages.join("")).toBe(text);
      for (const page of pages) {
        expect(page.length).toBeLessThanOrEqual(30000);
        expect(page.isWellFormed()).toBe(true);
      }
    }
  });
  test("clips only echoes with the specified head, tail and marker count", () => {
    const text = "a".repeat(15000) + "middle" + "b".repeat(15000);
    expect(clipEcho(text)).toBe(`${"a".repeat(15000)}\n[… 6 characters clipped …]\n${"b".repeat(15000)}`);
    expect(clipEcho("x".repeat(30000))).toHaveLength(30000);
    const unicode = "a".repeat(14999) + "😀" + "middle" + "😀" + "b".repeat(14999);
    expect(clipEcho(unicode)).toBe(`${"a".repeat(14999)}\n[… 10 characters clipped …]\n${"b".repeat(14999)}`);
    expect(clipEcho(unicode).isWellFormed()).toBe(true);
  });
  test("formats tool records, errors and attachments exactly", () => {
    expect(toolText("shell", { command: "echo 😀", nested: [1, true] })).toBe('shell {"command":"echo 😀","nested":[1,true]}');
    expect(echoText("failed\nwhy", true)).toBe("error: failed\nwhy");
    expect(echoText("done", false)).toBe("done");
    expect(fileLine("photo.png", "image/png", "files/4-0.png")).toBe("[file: photo.png image/png → files/4-0.png]");
    expect(fileLine("photo.png", "image/png")).toBe("[file: photo.png image/png, not available]");
  });
  test("formats dates in local time, including fractional-hour offsets", () => {
    const previous = process.env.TZ;
    try {
      const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
      process.env.TZ = "UTC";
      expect(formatDate(ms)).toBe("2026-01-02 03:04:05 +00:00 (Friday)");
      process.env.TZ = "Asia/Kolkata";
      expect(formatDate(ms)).toBe("2026-01-02 08:34:05 +05:30 (Friday)");
      process.env.TZ = "America/St_Johns";
      expect(formatDate(ms)).toBe("2026-01-01 23:34:05 -03:30 (Thursday)");
      expect(formatISODate(ms)).toBe("2026-01-02T03:04:05.000Z");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
