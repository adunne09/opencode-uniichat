# ADR-0041: No lock on the log

Accepted. Deviates from the recipe.

The recipe holds a lock so one process owns a chat. A session is never open in two OpenCode servers at once, and one server already serializes writes per chat, so the lock was redundant; a stale lock left behind by a server restart blocked the session. It was removed.
