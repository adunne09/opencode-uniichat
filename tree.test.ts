import { describe, expect, test } from "bun:test";
import { children, first, last, leafText, mergeText, name, NODE_LIMIT, parseZoom, parent, sibling } from "./tree.ts";

describe("summary tree", () => {
  test("maps names and inclusive ranges to parent, sibling and children", () => {
    expect(name(3, 5)).toBe("40+8");
    expect(first(3, 5)).toBe(40);
    expect(last(3, 5)).toBe(47);
    expect(parent([3, 5])).toEqual([4, 2]);
    expect(sibling([3, 5])).toEqual([3, 4]);
    expect(children([3, 5])).toEqual([[2, 10], [2, 11]]);
    expect(name(0, 0)).toBe("0+1");
    expect(() => children([0, 0])).toThrow(RangeError);
    expect(sibling([0, 2 ** 32])).toEqual([0, 2 ** 32 + 1]);
    expect(sibling([0, 2 ** 32 + 1])).toEqual([0, 2 ** 32]);
  });
  test("validates zoom without 32-bit truncation or floating-point false positives", () => {
    expect(parseZoom(8, 40)).toEqual([3, 5]);
    expect(parseZoom(1, 0)).toEqual([0, 0]);
    expect(parseZoom(2 ** 40, 2 ** 41)).toEqual([40, 2]);
    for (const n of [0, -1, 3, 1.5, NaN, Infinity, 2 ** 32 + 1, 2 ** 49 + 1, 2 ** 53]) {
      expect(parseZoom(n, 0)).toBeUndefined();
    }
    for (const id of [-1, 41, 0.5, NaN, Infinity, 2 ** 53]) expect(parseZoom(8, id)).toBeUndefined();
  });
  test("keeps a leaf verbatim only when kind and text fit in 512 bytes", () => {
    expect(NODE_LIMIT).toBe(512);
    expect(leafText("user", "x".repeat(506))).toBe("user: " + "x".repeat(506));
    expect(leafText("user", "x".repeat(507))).toBeUndefined();
    expect(leafText("user", "é".repeat(253))).toBe("user: " + "é".repeat(253));
    expect(leafText("user", "é".repeat(254))).toBeUndefined();
    expect(leafText("echo", "a\nb")).toBe("echo: a\nb");
  });
  test("joins children with a counted newline only when the merge fits", () => {
    expect(mergeText("x".repeat(255), "y".repeat(256))).toBe("x".repeat(255) + "\n" + "y".repeat(256));
    expect(mergeText("x".repeat(256), "y".repeat(256))).toBeUndefined();
    expect(mergeText("😀".repeat(64), "é".repeat(127) + "x")).toBeDefined();
    expect(mergeText("😀".repeat(64), "é".repeat(128))).toBeUndefined();
    expect(mergeText("", "")).toBe("\n");
  });
});
