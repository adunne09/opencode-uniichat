# ADR-0050: Find undone turns behind a compaction checkpoint

Accepted.

After an OpenCode compaction checkpoint the request may hold no logged message, so an undo went unnoticed. UniiChat then searches the session's full message list for the latest logged message still present and rewinds from there.
