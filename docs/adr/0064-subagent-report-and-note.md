# 0064 — Subagent reports and note as in the released source

Status: Accepted (2026-10-20). Amends ADR-0014 and ADR-0020 (report text) and ADR-0061 (note wording).

A subagent's report is logged, and stands in the request, as UniiChat's `report_text` writes it: `[Name]` on its own line, the report, then `Full chat: zoom("Name")`, so the line that opens the agent's whole chat is in the memory with its report.

The note added to a subagent's own OpenCode prompt (ADR-0015) is the source's `SUB_HEAD` and `VIEW_DOC` word for word, except where OpenCode differs: the subagent's chat with Unii is ordinary messages rather than `i|kind: text` lines, attachments are `[file: …]` lines rather than `[image …]`, and there are no devices or computer tasks.
