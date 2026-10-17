# ADR-0022: Compaction view on a chat-view merge

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D22
- Deviation from the recipe: No.

## Decision

Whenever the chat view merges, the compaction view is re-derived: a copy of the chat view, merged in due order (built parents only) down to ≤16 KB, carrying unfinished merges over to later messages like the chat view. It is also merged down to 16 KB on its own when it passes 32 KB. New chat lines are appended to both.
