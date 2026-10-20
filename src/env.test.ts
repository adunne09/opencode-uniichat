import { afterEach, expect, test } from "bun:test";
import { Model, Provider } from "@opencode/plugin/effect";
import { Path } from "@opencode/util/global";
import { Effect, Schema } from "effect";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { agentsMd, latestHaiku, stateInput } from "./env.ts";
import { stateText } from "./prompts.ts";

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "uniichat-env-")));
  temps.push(base);
  const dir = (...parts: string[]) => {
    const path = join(base, ...parts);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const configDirectory = dir("config");
  const home = dir("home");
  const projectDirectory = dir("project");
  return { base, dir, configDirectory, home, projectDirectory, directory: projectDirectory };
}

function instructions(directory: string, text: string) {
  const path = join(directory, "AGENTS.md");
  writeFileSync(path, text);
  return `Instructions from: ${realpathSync(path)}\n${text}`;
}

test("global only preserves raw text and excludes CLAUDE.md", async () => {
  const f = fixture();
  const expected = instructions(f.configDirectory, "global\n\n");
  writeFileSync(join(f.directory, "CLAUDE.md"), "not included");
  expect(await Effect.runPromise(agentsMd(f))).toBe(expected);
});

test("no instruction files returns undefined; directories are not files", async () => {
  const f = fixture();
  mkdirSync(join(f.configDirectory, "AGENTS.md"));
  mkdirSync(join(f.directory, "AGENTS.md"));
  expect(await Effect.runPromise(agentsMd(f))).toBeUndefined();
});

test("nested project walk is global first and nearest to farthest, including root", async () => {
  const f = fixture();
  const parent = f.dir("project", "a");
  const directory = f.dir("project", "a", "b");
  const expected = [
    instructions(f.configDirectory, "global"),
    instructions(directory, "nearest"),
    instructions(parent, "parent"),
    instructions(f.projectDirectory, "root"),
  ].join("\n\n");
  instructions(f.base, "above root");
  expect(await Effect.runPromise(agentsMd({ ...f, directory }))).toBe(expected);
});

test("start outside root excludes project files, including a common path prefix", async () => {
  const f = fixture();
  const directory = f.dir("project-other");
  const expected = instructions(f.configDirectory, "global");
  instructions(directory, "outside");
  instructions(f.base, "ancestor");
  expect(await Effect.runPromise(agentsMd({ ...f, directory }))).toBe(expected);
});

test("start under home walks above project root through home, then stops", async () => {
  const f = fixture();
  const projectDirectory = f.dir("home", "repo");
  const directory = f.dir("home", "repo", "nested");
  const expected = [
    instructions(directory, "nested"),
    instructions(projectDirectory, "repo"),
    instructions(f.home, "home"),
  ].join("\n\n");
  instructions(f.base, "above home");
  expect(await Effect.runPromise(agentsMd({ ...f, projectDirectory, directory }))).toBe(expected);
});

test("symlinked directories and files resolve and deduplicate globally", async () => {
  const f = fixture();
  const directory = f.dir("project", "nested");
  const expected = instructions(f.configDirectory, "shared");
  const nested = instructions(directory, "nested");
  symlinkSync(join(f.configDirectory, "AGENTS.md"), join(f.projectDirectory, "AGENTS.md"));
  symlinkSync(f.projectDirectory, join(f.base, "root-link"));
  symlinkSync(directory, join(f.base, "start-link"));
  symlinkSync(f.configDirectory, join(f.base, "config-link"));
  symlinkSync(f.home, join(f.base, "home-link"));
  expect(await Effect.runPromise(agentsMd({
    directory: join(f.base, "start-link"),
    projectDirectory: join(f.base, "root-link"),
    configDirectory: join(f.base, "config-link"),
    home: join(f.base, "home-link"),
  }))).toBe(`${expected}\n\n${nested}`);
});

test("default config directory honors OPENCODE_CONFIG_DIR at execution", async () => {
  const f = fixture();
  const expected = instructions(f.configDirectory, "override");
  const previous = process.env.OPENCODE_CONFIG_DIR;
  try {
    const effect = agentsMd({ directory: f.directory, projectDirectory: f.projectDirectory, home: f.home });
    process.env.OPENCODE_CONFIG_DIR = f.configDirectory;
    expect(await Effect.runPromise(effect)).toBe(expected);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previous;
  }
});

test("instruction file symlinks render the target path, not the discovered path", async () => {
  const f = fixture();
  const target = join(f.base, "instructions.md");
  writeFileSync(target, "linked instructions\n");
  symlinkSync(target, join(f.directory, "AGENTS.md"));
  expect(await Effect.runPromise(agentsMd(f))).toBe(`Instructions from: ${realpathSync(target)}\nlinked instructions\n`);
});

test("a real git repo in an ancestor sets git", async () => {
  const f = fixture();
  execFileSync("git", ["init", "--quiet", f.projectDirectory]);
  const directory = f.dir("project", "nested");
  expect((await Effect.runPromise(stateInput({ ...f, directory }))).git).toBe(true);
});

test("a real linked worktree with a .git file sets git", async () => {
  const f = fixture();
  execFileSync("git", ["init", "--quiet", f.projectDirectory]);
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "--allow-empty", "-m", "initial"], { cwd: f.projectDirectory });
  const directory = join(f.base, "worktree");
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", directory], { cwd: f.projectDirectory });
  expect((await Effect.runPromise(stateInput({ ...f, directory }))).git).toBe(true);
});

test("an invalid .git file is not a git repo", async () => {
  const f = fixture();
  writeFileSync(join(f.projectDirectory, ".git"), "gitdir: elsewhere");
  const directory = f.dir("project", "nested");
  expect((await Effect.runPromise(stateInput({ ...f, directory }))).git).toBe(false);
});

test("an empty .git directory is not a git repo", async () => {
  const f = fixture();
  mkdirSync(join(f.projectDirectory, ".git"));
  expect((await Effect.runPromise(stateInput(f))).git).toBe(false);
});

test("nearest hg marker stops discovery before an ancestor git marker", async () => {
  const f = fixture();
  execFileSync("git", ["init", "--quiet", f.projectDirectory]);
  const directory = f.dir("project", "nested");
  mkdirSync(join(directory, ".hg"));
  expect((await Effect.runPromise(stateInput({ ...f, directory }))).git).toBe(false);
});

test("git wins when both markers exist in the same directory", async () => {
  const f = fixture();
  execFileSync("git", ["init", "--quiet", f.directory]);
  mkdirSync(join(f.directory, ".hg"));
  expect((await Effect.runPromise(stateInput(f))).git).toBe(true);
});

test("state matches builtins rendering and keeps location spelling", async () => {
  const f = fixture();
  symlinkSync(f.projectDirectory, join(f.base, "repo-link"));
  const input = { directory: join(f.base, "repo-link"), projectDirectory: f.projectDirectory };
  const before = Date.now();
  const state = await Effect.runPromise(stateInput(input));
  const after = Date.now();
  expect(state.date.getTime()).toBeGreaterThanOrEqual(before);
  expect(state.date.getTime()).toBeLessThanOrEqual(after);
  expect(state.git).toBe(false);
  expect(stateText(state)).toBe([
    `Today's date: ${state.date.toDateString()}`,
    "",
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${input.directory}`,
    `  Workspace root folder: ${input.projectDirectory}`,
    "  Is directory a git repo: no",
    `  Platform: ${process.platform}`,
    `  Prefer ${realpathSync(Path.tmp)} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
    "</env>",
  ].join("\n"));
});

function model(provider: string, id: string, released: number): Model.Info {
  const info = Model.Info.default(Provider.ID.make(provider), Model.ID.make(id));
  return { ...info, time: { ...info.time, released } };
}

test("latest Haiku uses release time, provider and modelID, and keeps cost tiers", () => {
  const old = model("anthropic", "claude-haiku-99", 1);
  const latest = { ...model("anthropic", "claude-haiku-5-5", 10), id: Model.ID.make("alias"), cost: [
    { input: 1, output: 5, cache: { read: 0.1, write: 1.25 } },
    { tier: { type: "context" as const, size: 200000 }, input: 2, output: 10, cache: { read: 0.2, write: 2.5 } },
  ].map((cost) => Schema.decodeUnknownSync(Model.Cost)(cost)) };
  const models = [latest, model("anthropic", "claude-opus-9", 100), old, model("other", "claude-haiku-10", 200)];
  expect(latestHaiku(models)).toEqual({ modelID: latest.modelID, cost: latest.cost });
  expect(models[0]).toBe(latest);
});

test("latest Haiku returns undefined when no matching model exists", () => {
  expect(latestHaiku([])).toBeUndefined();
  expect(latestHaiku([model("other", "claude-haiku-5-5", 10), model("anthropic", "claude-haiku", 20)])).toBeUndefined();
});
