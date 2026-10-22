# 0067 — A step logs only rows that may still change

Status: Accepted (2026-10-22).

Native compaction is skipped (ADR-0007), so OpenCode's context for a UniiChat session is the whole session, and it keeps growing. Every step reconciled every logged segment of it: logging is idempotent, but each pass looked up every item's pages and read back every file it had saved. In a day-long chat (750 messages, 53 screenshots) a step spent about 0.9 s on this before the model was asked, and the cost grew with the session.

A row is now logged until it is settled, and then never again while the plugin runs: it is not the session's latest row, and, if a step, it has finished (`time.completed`) with every tool call done; if a shell command, it has ended. Rows that give no items are settled at once. Settled rows are kept per chat and session in memory, so a reload makes one full pass again, which also covers anything a crash left unlogged. Subagent sessions are logged the same way.

An undo only removes rows, so a settled row's records are never dropped while the row is still in the session (`undoneFrom` drops the tail after the latest present record). On the same chat, a step went from about 915 ms to 5 ms, and a turn's first step from about 1,860 ms to 13 ms.
