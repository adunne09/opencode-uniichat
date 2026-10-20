# 0063 — Follow the released UniiChat memory engine

Status: Accepted (2026-10-20)

## Authority

Use VictorTaelin/UniiChat at `0500bf6a8ea4bf0ce047488562022b1b6532cc30`, especially `Memory.ts`, `AskAI.ts`, `Server.ts`, and `Tools.ts`. The earlier recipe is historical context where they disagree. This amends earlier decisions on views, scheduling, cache marks, system refresh, zoom, and model calls; it supersedes ADR-0025's exclusion of shell results.

## Request behavior

- Compactions expose no tools, at both engine and transport boundaries. Their default output ceiling is 128,000 tokens; the requested summary remains 512 UTF-8 bytes. Five shortening attempts can still leave a longer shortest answer, matching the source.
- Merge inputs contain flattened child bodies, without `id+n|` headings. Main turns explicitly introduce the user's new message.
- Rebuild the system prompt at new turns using the current catalog, skills, and instruction files, including paths OpenCode has loaded. Preserve dynamic system notices in the raw request, retaining the latest pre-turn notice per instruction source.
- Main turns and child sessions wait for the relevant completed leaf prefix before freezing their view. Child agent prompts and OpenCode's child native compaction remain intact.
- Zoom defaults `n` to one, accepts numeric string IDs, and supports character-offset pagination for original messages and agent archives. `/btw`, RPC and the popup expose continuation pages. Attachments appear on the first message page.
- Preserve user shell results as echoes, subject to the existing echo clipping rule.

## Engine and storage

- Views are independent. Chat reaches the log end; compaction reaches the first unbuilt leaf. Count only built UTF-8 text, not addressing syntax or placeholders.
- Fit on append and on completion. Between appends, publish only batches reaching `low` or reducing size by at least `high`; a later append can advance a partial batch. Merge candidates use a heap over a linked view, with the source's age priority and oldest tie-break.
- Default to 64 jobs and a 64-pending-leaf horizon. Order runnable leaves and merges by context endpoint, then descending level. Persist instant results before admitting parents. Query ready merges through a disk index; keep only bounded candidate classifications in the production queue.
- JSONL remains authoritative, with a derived SQLite index for record/node addresses, source deduplication, agent names and ready merges. Read original records on demand; bound the node LRU and open file descriptors. Legacy logs build their index automatically. Reopen catches appended tails; corruption of the derived database rebuilds it. Rewind streams JSONL and refreshes addresses after file replacement. Existing undo archives, attachment protection, snapshot commits and ambiguous-write handling remain in use.
- Restore saved cuts and their durable suffix; absent snapshots recover the highest available built nodes. A saved parent does not imply every leaf has been built.
- Settings and chat registries belong to a plugin instance. A scoped 60-second maintenance loop retries failed background work. Readiness waits also retry with backoff. Unload interrupts model fibers, releases readiness waiters and closes indexes.

## Cache coordination

Plugin-owned calls share a transport cache gate. Chained keys include parent session, provider/model/variant, options, system, tool names, message roles and prefix content. Cache-marker placement is not part of prefix content. A follower waits on the longest live prefix; once headers arrive, all equal-prefix followers may reuse it until TTL (30 minutes for OpenAI routes, five minutes otherwise). Changed settings or rules yield different keys. Failed/cancelled leaders release followers without warming a prefix. Completed entries are bounded and expired entries are discarded.

This is intentionally scoped to plugin-owned calls and the parent session's cache identity. OpenCode owns main-request dispatch, credentials, provider cache behavior and billing. Successful completion is the fallback release point for non-HTTP transports. We do not infer cache hits or measured token savings from this coordination.

## OpenCode-specific boundaries

No cloud billing/credit holds, distributed process migration, or separate imported-history lane is introduced. Imports continue to block the first turn (ADR-0062). SQLite replaces the source's custom address files with a Bun-native indexed implementation. Integration registries live for the plugin lifetime; bounded history retention does not mean the entire OpenCode process or a single unbounded raw turn has constant memory.

## Verification

Deterministic tests cover source-shaped requests, dynamic instructions, child readiness, scheduler ordering and configurable caps, independent view batching, restart/torn-tail/rewind recovery, bounded cache retention, pagination and attachments, cache TTL/failure/cancellation, and plugin cleanup. TypeScript and the generated TUI freshness check are required. No paid model calls or live answer-quality/cache-cost claims are needed for these invariants.
