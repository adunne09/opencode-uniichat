# ADR-0050: Find undone turns behind a compaction checkpoint

- Status: Accepted
- Date: Oct 16, 2026
- Deviation from the recipe: Refines ADR-0040.

## Context

ADR-0040 finds undone records by the latest logged message still present in the session's context.
After an OpenCode compaction checkpoint, the context holds no logged message, so an undo went
unnoticed.

## Decision

When the latest logged message is missing from the context and no anchor is found in it, UniiChat
pages OpenCode's full message list for the latest logged message still in the session, and rewinds
from there.
