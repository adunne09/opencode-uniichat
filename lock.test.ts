import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { acquire } from "./lock.ts";

test("one process shares its lock, but another process cannot acquire it", async () => {
  const path = join(mkdtempSync("/tmp/opencode/uniichat-lock-"), "chat.lock");
  await Effect.runPromise(acquire(path));
  await Effect.runPromise(acquire(path));
  const module = new URL("./lock.ts", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "-e", `
    import { Effect } from "effect";
    import { acquire } from ${JSON.stringify(module)};
    const result = await Effect.runPromise(Effect.result(acquire(${JSON.stringify(path)})));
    if (result._tag !== "Failure" || result.failure._tag !== "LockHeld" || result.failure.path !== ${JSON.stringify(path)}) process.exit(1);
  `], { cwd: new URL("../../", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited, stderr).toBe(0);
});
