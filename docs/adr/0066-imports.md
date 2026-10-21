# 0066 — Import past sessions as UniiChat imports past chats

Status: Accepted (2026-10-20). Amends ADR-0063's "no separate imported-history lane".

UniiChat's `/import` (Import.ts, Server.ts Chat.ingest) brings a person's past chats into the one chat: each session a note, then its messages, oldest session first, logged at the chat's end and flagged imported. Their AI's replies and tool calls read as `ai`, not as Unii's. Their summaries build on a side of their own (Memory.ts `side`): JOBS of each side at once, a turn waiting only for the chat's side (Memory.settle), the turn's view leaving out lines not built, the compactions' view reaching only the first message not built of the sides that build. An import can be paused, and another waits for it to end.

`scripts/import.ts` reads past OpenCode sessions into such a body (`src/importer.ts`): the user's words and the AI's replies, tool steps only with `--tools`, never reasoning, OpenCode's compaction summaries, injected prompts, skills' instructions or subagents' sessions. The estimate is Import.ts's price model. The plugin's `import` RPC logs the body; `importStatus` and `importPause` follow and hold it, and `import.json` keeps it across restarts.

An undo never takes an import with it. Imported records are not the session's own messages, so the undo check skips them, and a rewind that would cut into one is refused.

`import.leaves` (default 64, UniiChat's JOBS) sets how many imported messages are summarized at once. At 1 each one's summary sees every message before it, at the cost of time; merges still run `compaction.concurrency` at once.

Switching UniiChat on in a session that already has turns still logs them as its own and blocks the first turn (ADR-0062).
