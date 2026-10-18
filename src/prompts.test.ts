import { describe, expect, test } from "bun:test";
import { leafTask, mergeTask, RULER, systemText, tooLong, stateText } from "./prompts.ts";

const recipeLeaf = `Compaction: compress message {id} into one line of at most 512 bytes
(about 70 words), the length of this ruler:
------------…------------
<input>
{kind}: {the message, whole}
</input>`;
const recipeMerge = `Compaction: merge lines {a} and {b}, adjacent, into one line of at most
512 bytes (about 70 words), the length of this ruler:
------------…------------
<chat> may hold their messages, {id} to {end}, in more detail: take details
of them from there too.
<input>
{line a}
{line b}
</input>`;
const recipeTooLong = `Too long: your line is {N} bytes, over the 512-byte limit. Write
the whole line again for the same <input>, cutting just enough of the
least valuable items to fit before this cut:
{its first 512 bytes}| ← LIMIT`;

describe("recipe prompts", () => {
  test("joins only present instructions in D13 order", () => {
    expect(systemText("prompt", "catalog", "agents")).toBe("prompt\n\ncatalog\n\nagents");
    expect(systemText("prompt", "catalog", "agents", "skills")).toBe("prompt\n\ncatalog\n\nskills\n\nagents");
    expect(systemText("prompt", undefined, "agents", "skills")).toBe("prompt\n\nskills\n\nagents");
    expect(systemText("prompt", "", "agents")).toBe("prompt\n\nagents");
    expect(systemText("", undefined, "agents")).toBe("agents");
    expect(systemText("")).toBe("");
  });
  test("matches the leaf task and keeps the whole input", () => {
    const text = "hello\n😀 <input>";
    const expected = recipeLeaf.replace("{id}", "4").replace("------------…------------", RULER)
      .replace("{kind}", "user").replace("{the message, whole}", text);
    expect(leafTask(4, "user", text)).toBe(expected);
  });
  test("matches the merge task, names, inclusive ids and D29 rendered lines", () => {
    const expected = recipeMerge.replace("{a}", "40+4").replace("{b}", "44+4")
      .replace("{id}", "40").replace("{end}", "47").replace("------------…------------", RULER)
      .replace("{line a}", "40+4|user: a echo: b").replace("{line b}", "44+4|unii: c tool: d");
    expect(mergeTask("40+4", "44+4", 40, 47, "40+4|user: a\necho: b", "44+4|unii: c\ntool: d")).toBe(expected);
  });
  test("matches the retry text and cuts a UTF-8 prefix", () => {
    const expected = recipeTooLong.replace("{N}", "515").replace("{its first 512 bytes}", "x".repeat(511));
    expect(tooLong(515, "x".repeat(511) + "😀")).toBe(expected);
    expect(tooLong(516, "😀".repeat(129))).toBe(recipeTooLong.replace("{N}", "516")
      .replace("{its first 512 bytes}", "😀".repeat(128)));
  });
  test("matches the built-in state byte for byte", () => {
    const date = new Date(2026, 9, 9, 12);
    const expected = `Today's date: Fri Oct 09 2026

Here is some useful information about the environment you are running in:
<env>
  Working directory: /work/project/sub
  Workspace root folder: /work/project
  Is directory a git repo: yes
  Platform: linux
  Prefer /tmp/opencode over generic system temporary directories such as /tmp; it is pre-created and approved for external access.
</env>`;
    const state = { date, directory: "/work/project/sub", root: "/work/project", git: true, platform: "linux", tmp: "/tmp/opencode" };
    expect(stateText(state)).toBe(expected);
    expect(stateText({ ...state, git: false })).toBe(expected.replace("git repo: yes", "git repo: no"));
  });
});
