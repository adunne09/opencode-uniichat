import type { Model } from "@opencode/plugin/effect";
import { Path } from "@opencode/util/global";
import { Effect } from "effect";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { StateInput } from "./prompts.ts";

export interface LocationInput {
  directory: string;
  projectDirectory: string;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function* ancestors(start: string, stop?: string): Generator<string> {
  let current = start;
  while (true) {
    yield current;
    const parent = dirname(current);
    if (current === stop || parent === current) return;
    current = parent;
  }
}

const ioError = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));

export function agentsMd(input: LocationInput & { configDirectory?: string; home?: string }): Effect.Effect<string | undefined, Error> {
  return Effect.try({
    try: () => {
      const start = canonical(input.directory);
      const root = canonical(input.projectDirectory);
      const home = canonical(input.home ?? Path.home);
      const global = canonical(join(input.configDirectory ?? process.env.OPENCODE_CONFIG_DIR ?? Path.config, "AGENTS.md"));
      const files = new Set<string>();
      if (isFile(global)) files.add(global);
      if (contains(root, start)) {
        for (const directory of ancestors(start, contains(home, start) ? home : root)) {
          const file = canonical(join(directory, "AGENTS.md"));
          if (isFile(file)) files.add(file);
        }
      }
      const rendered = [...files].map((file) => `Instructions from: ${file}\n${readFileSync(file, "utf8")}`);
      return rendered.length ? rendered.join("\n\n") : undefined;
    },
    catch: ioError,
  });
}

export function stateInput(input: LocationInput): Effect.Effect<StateInput, Error> {
  return Effect.try({
    try: () => {
      let git = false;
      for (const directory of ancestors(canonical(input.directory))) {
        if (existsSync(join(directory, ".git"))) {
          const result = spawnSync("git", ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"], {
            cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
          });
          const [gitDir, commonDir] = result.stdout?.split(/\r?\n/) ?? [];
          git = result.status === 0 && !!gitDir && !!commonDir;
          break;
        }
        if (existsSync(join(directory, ".hg"))) break;
      }
      return {
        date: new Date(),
        directory: input.directory,
        root: input.projectDirectory,
        git,
        platform: process.platform,
        tmp: realpathSync(Path.tmp),
      };
    },
    catch: ioError,
  });
}

export function latestHaiku(models: ReadonlyArray<Pick<Model.Info, "modelID" | "providerID" | "time" | "cost">>): { modelID: Model.Info["modelID"]; cost: Model.Info["cost"] } | undefined {
  let latest: (typeof models)[number] | undefined;
  for (const model of models) {
    if (model.providerID !== "anthropic" || !model.modelID.startsWith("claude-haiku-")) continue;
    if (!latest || model.time.released > latest.time.released) latest = model;
  }
  return latest ? { modelID: latest.modelID, cost: latest.cost } : undefined;
}
