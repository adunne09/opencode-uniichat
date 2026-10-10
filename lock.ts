import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Data, Effect } from "effect";

export class LockHeld extends Data.TaggedError("LockHeld")<{ path: string }> {
  override get message(): string {
    return `UniiChat cannot lock ${this.path}; another process may hold it.`;
  }
}

const held = new Map<string, number>();
let libc: ReturnType<typeof loadLibc> | undefined;
function loadLibc() {
  return dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
}

export function acquire(path: string): Effect.Effect<void, LockHeld> {
  return Effect.try({
    try: () => {
      const absolute = resolve(path);
      const key = join(realpathSync(dirname(absolute)), basename(absolute));
      if (held.has(key)) return;
      libc ??= loadLibc();
      const fd = openSync(key, "a", 0o600);
      if (libc.symbols.flock(fd, 2 | 4) !== 0) {
        closeSync(fd);
        throw new LockHeld({ path });
      }
      // Keep this fd open for the process lifetime.
      held.set(key, fd);
    },
    catch: () => new LockHeld({ path }),
  });
}
