# 0065 — A turn too large for its context rolls over into the view

Status: Accepted (2026-10-20). Supersedes ADR-0008; amends ADR-0051.

UniiChat's call has no limit of its own: a turn whose tool steps outgrow the model's context fails. Its rule for what a call holds whole is Memory.whole: a turn's messages go whole up to HIGH (128 KB), and the rest is read from the view, in summaries the model can zoom. This applies that rule to a turn that grows.

OpenCode decides when a turn is too large, from the last request it sent, and asks for a compaction; UniiChat answers with its stub (ADR-0007), so no summary is written and nothing is dropped. A stub after the turn's opening message is the turn's rollover point. Every step before it is already in the log, so the turn waits for them to be summarized, freezes its view again (now holding the turn so far), and from then on sends: the view, the per-turn state, the turn head and the opening message again, a note saying where its steps went, then only OpenCode's messages after the stub. A later stub rolls it over again. An opening message over 128 KB is not repeated: as in Memory.whole, the view holds it, and a pointer says where.

`/btw` mid-turn uses the same rolled view and tail. If the full message list is unreachable the opening is unknown, and the request starts at the stub's checkpoint as before.
