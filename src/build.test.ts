import { expect, test } from "bun:test";
import { join } from "node:path";

test("dist/tui.js is built from the current src/tui.tsx", () => {
  const result = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/build-tui.ts"), "--check"], { stderr: "pipe", stdout: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
}, 60_000);
