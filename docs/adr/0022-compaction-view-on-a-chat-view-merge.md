# ADR-0022: Compaction view after a chat-view merge

Accepted.

Whenever the chat view merges, the compaction view is rebuilt from a copy of it, merged down to 16 KB. It is also merged down on its own when it passes 32 KB. New lines are appended to both.
