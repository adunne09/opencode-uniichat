# UniiChat for OpenCode

**This plugin implements Victor Taelin's UniiChat recipe:
[UniiChat: one chat that never ends](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449).**
Read the recipe first. It is the whole design. This plugin follows it as closely as OpenCode allows,
and the [deviations](#deviations-from-the-recipe) are listed below. The code follows the recipe at
revision [`3c190e0`](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449/3c190e06f34aba0c69f49042c526093269604935)
(Oct 8, 2026).

The recipe's idea in one line: the chat itself is the memory. Every message is logged word for word.
A cheap model compresses the log into a binary tree of one-line summaries, and each turn starts a
fresh call that sees a fixed-size **view** of that tree. When a line is too vague, the model
**zooms** into the lines it was made from, down to the message itself. The context stays the same
size and nothing is lost.

## What it does in OpenCode

UniiChat is switched on per session and is off by default. While a session has it on:

- Each model request holds only the tools, Unii's system prompt (with your AGENTS.md), the memory view,
  per-turn state, and the current turn's raw messages. Earlier raw turns are not resent. OpenCode's
  stored transcript is untouched, so scrollback still works.
- Old memory is compacted in the background by a cheap model. By default that is the newest Claude
  Haiku in your OpenCode setup. It goes through your own OpenCode providers and credentials.
- OpenCode's native compaction is skipped. A placeholder is recorded instead.
- Two tools are added: `zoom` (open archived memory) and `date`.
- Subagents always run in the background, and their reports come back as `work` messages.
- `/btw` answers from Unii's memory instead of the full transcript.

Memory is stored under `<OpenCode data dir>/uniichat/<sessionID>/`, normally
`~/.local/share/opencode/uniichat/`, in the recipe's file layout.

## Install

You need OpenCode v2 (tested with 2.0.32). This is not a v1 plugin.

```sh
opencode plugin add github:maxandron/opencode-uniichat
```

To pin a version, add a tag or full commit hash: `github:maxandron/opencode-uniichat#<tag-or-sha>`. To update,
run `opencode plugin check`, then `opencode plugin update`.

Or add it by hand. The server part goes in `opencode.json(c)` and the terminal UI part goes in
`cli.json`:

```jsonc
// opencode.json(c)
"plugins": [{ "package": "github:maxandron/opencode-uniichat", "options": { /* see Options */ } }]
// cli.json
"plugins": [{ "package": "github:maxandron/opencode-uniichat", "options": { "tui": { "sidebar": true } } }]
```

Compaction needs a model. With no `compaction.model` option, UniiChat uses the newest
`anthropic/claude-haiku-*` that OpenCode lists, so you need an Anthropic provider set up in OpenCode
(an API key, or an auth plugin of your choice). With any other provider, set `compaction.model`.

## Use

- `/unii on` switches UniiChat on for the current session, starting at the next turn. With no session
  open, it starts a new session with UniiChat on. The first time, the session's earlier turns are
  imported into memory.
- `/unii off` returns the session to vanilla OpenCode. Memory is kept, and `/unii on` resumes it.
- `/unii` opens the memory popup. It shows the status and the live view. Up/Down move, Enter or a
  click zooms into a line, and Esc goes back and then closes.
- The sidebar shows whether UniiChat is on, and `· compaction error (/unii)` when a compaction failed.
  The popup shows the error.

The system prompt (with AGENTS.md, the skills list and the Code Mode catalog) is frozen at `/unii on`.
To pick up edits, run `/unii off` and then `/unii on`.

## Options

All options are optional. They go in the plugin's `options` object. The defaults are the recipe's
values. Changing them away from the recipe is a deviation of your own.

| Option | Default | What it does |
| --- | --- | --- |
| `defaultOn` | `false` | Sessions never switched on or off start with UniiChat on. |
| `compaction.model` | newest `anthropic/claude-haiku-*` | Compaction model, as `"providerID/modelID"`. |
| `compaction.variant` | none | A model variant, as OpenCode names them (e.g. `"high"`). |
| `compaction.maxTokens` | `32000` | Output limit for one compaction call. |
| `compaction.providerOptions` | Anthropic: `{ "thinking": { "type": "adaptive", "display": "summarized" }, "effort": "high" }`; otherwise `{}` | Provider options sent with each compaction call. Setting it (or `variant`) replaces the Anthropic default. |
| `compaction.timeoutMs` | `240000` | A call with no answer by then fails, and is retried. |
| `compaction.tries` | `5` | Tries per node in the recipe's "Too long" loop. |
| `compaction.concurrency` | `8` | Compaction calls in flight at once. |
| `view.chat` | `{ "high": 128000, "low": 64000 }` | Chat view byte budget: when it passes `high`, it is merged down to `low`. |
| `view.compaction` | `{ "high": 32000, "low": 16000 }` | Compaction view byte budget. |
| `btw.lookupSteps` | `8` | Memory lookups (zoom/date) allowed before a `/btw` answer. `0` answers from the view only. |
| `btw.maxTokens` | `4000` | Output limit for one lookup call. |
| `prompts.system` | the recipe's prompt, agent name "Unii" | The system prompt. Your AGENTS.md, the skills list and the Code Mode catalog are added to it. |
| `prompts.subagent` | built in | Note appended to a subagent's own system prompt. |
| `prompts.btwLookup` | built in | Instructions added to a `/btw` question during lookups. |
| `tui.pollMs` | `2000` | Refresh interval of the popup and sidebar. Set it in `cli.json`. |
| `tui.sidebar` | `true` | Show the sidebar line. Set it in `cli.json`. |

Prompts are plain strings. A prompt change reaches a session at its next `/unii on`. The 512-byte line
limit, the ruler and the file formats are fixed, because changing them would break existing memories.

## Deviations from the recipe

Each one is an [architecture decision record](docs/adr/README.md), which gives the reasons.

1. **One chat per OpenCode session, not one chat forever**
   ([0000](docs/adr/0000-follow-the-recipe.md), [0006](docs/adr/0006-switch.md)). Each session has
   its own memory and its own on/off switch. Off is plain OpenCode.
2. **The fresh call happens inside the OpenCode session** ([0001](docs/adr/0001-fresh-call-per-turn-inside-one-opencode-session.md)).
   The recipe calls each turn "in a fresh session". Here the session stays for its UI and transcript,
   and only the model request is rebuilt as `[tools][system][view][state][message]` plus the turn's
   own steps.
3. **System prompt** ([0002](docs/adr/0002-system-prompt.md), [0013](docs/adr/0013-codemode-catalog.md),
   [0045](docs/adr/0045-skills-in-system-prompt.md)). This is the recipe's prompt without the "open
   devices" paragraph, because OpenCode tools run locally. It is followed by OpenCode's Code Mode
   catalog, its skills list and your AGENTS.md.
4. **Compaction model and effort** ([0048](docs/adr/0048-compaction-effort-high.md),
   [0052](docs/adr/0052-model-calls-through-opencode.md)). The default is Claude Haiku at `high`
   effort, not `xhigh`. At `xhigh` it sometimes spent its whole output limit thinking. Any model
   OpenCode can call may be set instead.
5. **Compaction calls go through OpenCode** ([0052](docs/adr/0052-model-calls-through-opencode.md)).
   Each call runs in a throwaway child session, so it uses your providers and credentials. The
   system prompt, view, cache marks and task are the recipe's. The tools are the ones OpenCode
   offers that session. If they differ from the chat's, the call misses the turns' cache.
6. **Extra cache marks** ([0005](docs/adr/0005-cache-marks.md)). OpenCode may add up to two cache
   marks of its own on the tools/system prefix.
7. **No lock on the log** ([0041](docs/adr/0041-drop-chat-lock.md)). The recipe says "hold a lock".
   A session is never open in two OpenCode servers at once, so the lock was redundant, and a stale
   lock left by a server restart blocked the session.
8. **Subagents keep their own system prompt** ([0015](docs/adr/0015-subagent-system-prompt.md)). The
   recipe makes a subagent a fresh call that starts with the view. Here a subagent also keeps its
   OpenCode agent's prompt, plus a note about the view. With Unii's prompt, subagents took their
   task for a compaction.
9. **Undo removes messages from memory** ([0040](docs/adr/0040-undo-drops-the-undone-turn.md),
   [0050](docs/adr/0050-undo-behind-checkpoint.md)). The recipe says never delete a line. OpenCode's
   `/undo` deletes messages, so the undone records are moved to `undone/<stamp>/` and their ids are
   reused.
10. **User-run shell commands are not logged** ([0025](docs/adr/0025-shell-messages.md)).
11. **Earlier turns are imported as messages** ([0043](docs/adr/0043-import-earlier-turns.md)). When a
    session is switched on mid-way, its earlier turns are logged as ordinary messages, not as `note`
    memories.

These are additions the recipe does not cover:
- native-compaction placeholder ([0007](docs/adr/0007-native-compaction.md), [0051](docs/adr/0051-see-past-the-stub.md))
- compaction timeout ([0042](docs/adr/0042-compaction-call-timeout.md))
- `/btw` from memory ([0046](docs/adr/0046-btw-from-memory.md))
- the popup ([0012](docs/adr/0012-ui.md), [0047](docs/adr/0047-popup-browse.md))
- options ([0054](docs/adr/0054-plugin-options.md))

## Limitations

- OpenCode's generate API returns text only. The popup shows compaction call counts and times, but
  not token usage or cost. When a compaction returns no text, the reason is not reported.
- A compaction's throwaway session may show briefly as a child session.
- If a single turn outgrows the model's context window, the request fails (recipe-strict, [0008](docs/adr/0008-raw-turn-overflow.md)).
- Tested on Linux with Bun 1.4.

## Development

```sh
bun install
bun test src          # unit tests, including a check that dist/tui.js is current
bun run check         # type check + dist/tui.js staleness
bun run build         # rebuild dist/tui.js after changing src/tui.tsx or src/rpc.ts
```

For local development, point both configs at the checkout's `src/` directory, e.g.
`"plugins": ["/path/to/opencode-uniichat/src"]`. Local plugins hot-reload, and the TUI loads from
`src/tui.tsx` directly. Installed copies load `dist/tui.js`, because OpenCode does not compile `.tsx`
under `node_modules`. So commit a rebuilt `dist/tui.js` with every TUI change.

New design decisions get an ADR in [`docs/adr/`](docs/adr/README.md).

## License

[MIT](LICENSE). Fork it, change it, redistribute it.
