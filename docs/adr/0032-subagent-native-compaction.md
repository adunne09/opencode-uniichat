# ADR-0032: Subagent native compaction

- Status: Accepted
- Date: Oct 9, 2026 (Q4, approved Oct 9)
- Spec: D32
- Deviation from the recipe: Not covered by the recipe (OpenCode-specific).

## Decision

D7 does not apply to children: a UniiChat child compacts like vanilla OpenCode, and the view is prepended to whatever first message remains after the checkpoint.
