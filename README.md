# UniiChat for OpenCode

**This plugin adapts [Victor Taelin's UniiChat](https://github.com/VictorTaelin/UniiChat) to OpenCode.**

The released implementation is authoritative where it differs from the original [recipe](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449). Source-aligned behavior is pinned to UniiChat commit `0500bf6a8ea4bf0ce047488562022b1b6532cc30` (Oct 20, 2026); see [ADR-0063](docs/adr/0063-current-source-fidelity.md) for the port's boundaries.

The recipe's idea in one line: the chat itself is the memory. Every message is logged word for word. A cheap model compresses the log into a binary tree of one-line summaries, and each turn starts a fresh call that sees a fixed-size **view** of that tree. When a line is too vague, the model **zooms** into the lines it was made from, down to the message itself. The context stays the same size and nothing is lost.

## What it does in OpenCode

UniiChat is switched on per session and is off by default (opt-in via `/unii on`). While a session has it on:

- Each model request holds only the tools, skills, Unii's system prompt, AGENTS.md, the memory view, per-turn state, and the current turn's raw messages.
- OpenCode's stored transcript is untouched, so scrollback still works.
- Old memory is compacted in the background by a cheap model.
- OpenCode's native compaction is skipped.
- Two tools are added: `zoom` (open archived memory) and `date`.
- Subagents always run in the background, and their reports come back as `work` messages.
- `/btw` answers from Unii's memory instead of the full transcript.

Memory is stored under `<OpenCode data dir>/uniichat/<sessionID>/`, normally `~/.local/share/opencode/uniichat/`. JSONL logs and attachments remain authoritative. A disposable `archive.index.sqlite` indexes record locations, source IDs, and ready tree nodes; legacy logs are indexed automatically. The engine reads history on demand and retains a bounded node cache instead of loading all log bodies.

## Install

You need OpenCode v2.1 or later. v0.2.0 and earlier need v2.0.

```sh
opencode plugin add github:maxandron/opencode-uniichat
```

To pin a version, add a tag or full commit hash: `github:maxandron/opencode-uniichat#<tag-or-sha>`. To update, run `opencode plugin check`, then `opencode plugin update`.

Or add it by hand. The server part goes in `opencode.json(c)` and the terminal UI part goes in `cli.json`:

```jsonc
// opencode.json(c)
"plugins": [{ "package": "github:maxandron/opencode-uniichat", "options": { /* see Options */ } }]
// cli.json
"plugins": [{ "package": "github:maxandron/opencode-uniichat", "options": { "tui": { "sidebar": true } } }]
```

## Use

- `/unii on` switches UniiChat on for the current session, starting at the next turn. With no session open, it starts a new session with UniiChat on. The first time, the session's earlier turns are imported into memory.
- `/unii off` returns the session to vanilla OpenCode. Memory is kept, and `/unii on` resumes it.
- `/unii` opens the memory popup. Up/Down move, Enter or a click zooms into a line, `n` opens the next archive page when available, and Esc goes back and then closes.
- The sidebar shows whether UniiChat is on, and `· compaction error (/unii)` when a compaction failed. The popup shows the error.

The system prompt, loaded instruction files, skills list and Code Mode catalog refresh at each new turn. Dynamic system notices remain in the outgoing request. A subagent waits for the parent's summaries before freezing its memory view.

`zoom(id)` defaults to the original message (`n = 1`). Long messages and named agent archives return pages of up to 30,000 characters, with a continuation offset: `zoom(id, n, at)` or `zoom("agent-name", 1, at)`. Attachments accompany the first message page only.

## Options

All options are optional ;)

They go in the plugin's `options` object. Settings are isolated per plugin instance.


| Option | Default | What it does |
| --- | --- | --- |
| `defaultOn` | `false` | Sessions never switched on or off start with UniiChat on. |
| `compaction.model` | newest `anthropic/claude-haiku-*` | Compaction model, as `"providerID/modelID"`. |
| `compaction.variant` | `"high"` | Model variant, as OpenCode names them. |
| `compaction.maxTokens` | `128000` | Output-token ceiling for one tool-free compaction call; the summary target remains 512 UTF-8 bytes. |
| `compaction.providerOptions` | `{}` | Extra provider options sent with each compaction call. |
| `compaction.timeoutMs` | `240000` | A call with no answer by then fails, and is retried. |
| `compaction.tries` | `5` | Tries per node in the "Too long" loop. |
| `compaction.concurrency` | `64` | Compaction calls in flight and the pending-leaf window. Leaves and merges are ordered by context endpoint, merges first at ties. |
| `view.chat` | `{ "high": 128000, "low": 64000 }` | Chat view byte budget: when it passes `high`, it is merged down to `low`. |
| `view.compaction` | `{ "high": 32000, "low": 16000 }` | Independent compaction view budget, covering only the completed leaf prefix. |
| `btw.lookupSteps` | `8` | Memory lookups (zoom/date) allowed before a `/btw` answer. `0` answers from the view only. |
| `btw.maxTokens` | `4000` | Output limit for one lookup call. |
| `prompts.system` | the recipe's prompt, agent name "Unii" | The system prompt. Your AGENTS.md, the skills list and the Code Mode catalog are added to it. |
| `prompts.subagent` | built in | Note appended to a subagent's own system prompt. |
| `prompts.btwLookup` | built in | Instructions added to a `/btw` question during lookups. |
| `tui.pollMs` | `2000` | Refresh interval of the popup and sidebar. Set it in `cli.json`. |
| `tui.sidebar` | `true` | Show the sidebar line. Set it in `cli.json`. |


Prompts are plain strings. After plugin reload, changes reach sessions at their next turn. View budgets count built node text in UTF-8 bytes, excluding addresses and placeholders. Background completion publishes a merge batch once it reaches `low` or removes at least `high` bytes; a new append may advance a partial batch.

## Deviations from the recipe

Each one is an [architecture decision record](docs/adr/README.md).

1. **One chat per OpenCode session** ([0000](docs/adr/0000-follow-the-recipe.md), [0006](docs/adr/0006-switch.md)). Each session has its own memory and its own on/off switch. Off is plain OpenCode.
2. **The fresh call happens inside the OpenCode session** ([0001](docs/adr/0001-fresh-call-per-turn-inside-one-opencode-session.md)). The recipe calls each turn "in a fresh session". Here the session stays for its UI and transcript, and only the model request is rebuilt as `[tools][system][view][state][message]` plus the turn's own steps.
3. **System prompt** ([0002](docs/adr/0002-system-prompt.md), [0013](docs/adr/0013-codemode-catalog.md), [0045](docs/adr/0045-skills-in-system-prompt.md)). This is the recipe's prompt without the "open devices" paragraph, because OpenCode tools run locally.
4. **Compaction model and effort** ([0048](docs/adr/0048-compaction-effort-high.md), [0052](docs/adr/0052-model-calls-through-opencode.md)). The default is Claude Haiku at `high` effort, not `xhigh`. At `xhigh` it sometimes spent its whole output limit thinking. Victor's released code also uses `high`.
5. **Compaction calls go through OpenCode** ([0052](docs/adr/0052-model-calls-through-opencode.md)). Each call runs in a throwaway child session, so it uses your providers and credentials.
6. **Extra cache marks** ([0005](docs/adr/0005-cache-marks.md)). OpenCode may add up to two cache marks of its own on the tools/system prefix.
7. **No lock on the log** ([0041](docs/adr/0041-drop-chat-lock.md)). The recipe says "hold a lock". A session is never open in two OpenCode servers at once, so the lock was redundant.
8. **Subagents keep their own system prompt** ([0015](docs/adr/0015-subagent-system-prompt.md)). The recipe makes a subagent a fresh call that starts with the view. Here a subagent also keeps its OpenCode agent's prompt, plus a note about the view.
9. **Undo removes messages from memory** ([0040](docs/adr/0040-undo-drops-the-undone-turn.md), [0050](docs/adr/0050-undo-behind-checkpoint.md)). The recipe says never delete a line. OpenCode's `/undo` deletes messages, so the undone records are moved to `undone/<stamp>/` and their ids are reused.
10. **User-run shell results are logged as echoes**, using the same clipping policy as other tool output ([0063](docs/adr/0063-current-source-fidelity.md), superseding [0025](docs/adr/0025-shell-messages.md)).
11. **Earlier turns are imported as messages** ([0043](docs/adr/0043-import-earlier-turns.md)). When a session is switched on mid-way, its earlier turns are logged as ordinary messages, not as `note` memories.

These are additions the recipe does not cover:

- native-compaction placeholder ([0007](docs/adr/0007-native-compaction.md), [0051](docs/adr/0051-see-past-the-stub.md))
- compaction timeout ([0042](docs/adr/0042-compaction-call-timeout.md))
- `/btw` from memory ([0046](docs/adr/0046-btw-from-memory.md))
- the popup ([0012](docs/adr/0012-ui.md), [0047](docs/adr/0047-popup-browse.md))

Victor has since released his code, [VictorTaelin/UniiChat](https://github.com/VictorTaelin/UniiChat). These follow that code where it differs from the recipe:

- a compaction that returns no text uses its source clipped to 512 bytes ([0056](docs/adr/0056-no-text-clips-the-source.md))
- the "fast and small" paragraph at the end of the system prompt ([0057](docs/adr/0057-compaction-prompt-fast-and-small.md))
- "Too long" retries resend the first request with one note ([0058](docs/adr/0058-too-long-retry-single-note.md))
- failed and stopped turns leave a `note` in memory ([0059](docs/adr/0059-failed-turns-leave-a-note.md))
- a bad zoom lists the tree's roots ([0060](docs/adr/0060-zoom-error-lists-roots.md))
- the subagent note explains the view ([0061](docs/adr/0061-subagent-note-explains-the-view.md)), in the source's own words, and reports end with `Full chat: zoom("Name")` ([0064](docs/adr/0064-subagent-report-and-note.md))
- options ([0054](docs/adr/0054-plugin-options.md))
- tool-free 128k-token compaction, unheaded merge inputs, explicit turn heading, refreshed rules, subagent readiness, paginated zoom, independent background-maintained views, endpoint scheduling, TTL cache single-flight, and indexed bounded-retention storage ([0063](docs/adr/0063-current-source-fidelity.md))

One difference from that code is kept on purpose. Victor's turns don't wait for an import to be summarized. Here the first turn after switch-on waits, so the model sees the whole session ([0062](docs/adr/0062-imports-block-the-first-turn.md)).

## Limitations

- OpenCode's generate API returns text only. The popup shows compaction call counts and times, but not token usage or cost. When a compaction returns no text, the reason is not reported; the node uses its source clipped.
- A compaction's throwaway session may show briefly as a child session.
- Cache single-flight covers plugin-owned model calls. It waits for successful HTTP response headers, or successful completion on transports without HTTP hooks; native provider cache reuse is not measured by this plugin.
- Indexed logs bound retained history bodies; OpenCode still owns the full transcript and the current raw turn. Imported earlier turns use the same queue as live history, rather than UniiChat's separate billing/import lanes.
- A turn that outgrows the model's context rolls over: when OpenCode asks to compact it, its steps so far move into the view as summaries and only later steps stay raw ([0065](docs/adr/0065-turn-rollover.md)). OpenCode decides when, from the last request it sent, so a first request already over the limit still fails.
- Tested with Bun 1.4, including macOS regression coverage.

## Development

```sh
bun install
bun test src          # unit tests, including a check that dist/tui.js is current
bun run check         # type check + dist/tui.js staleness
bun run build:tui       # rebuild dist/tui.js after changing src/tui.tsx or src/rpc.ts
```

For local development, point both configs at the checkout's `src/` directory, e.g. `"plugins": ["/path/to/opencode-uniichat/src"]`. Local plugins hot-reload, and the TUI loads from `src/tui.tsx` directly. Installed copies load `dist/tui.js`, because OpenCode does not compile `.tsx` under `node_modules`. So commit a rebuilt `dist/tui.js` with every TUI change.

New design decisions get an ADR in [`docs/adr/`](docs/adr/README.md).
