# ADR-0043: Import earlier vanilla turns on first switch-on

- Status: Accepted
- Date: Oct 11, 2026
- Deviation from the recipe: No: R§1 has the `note` kind for memories from before the chat; here the earlier turns are logged as ordinary messages.

## Context

`/unii on` in the middle of a session dropped every turn before it: ADR-0001 sends only the current
turn raw, and the store started empty, so Unii had no memory of what came before.

## Decision

The user: "Import the earlier turns on first switch-on." When a session is switched on with an empty
store, its earlier turns (from before any native compaction checkpoint, when OpenCode's full message
list is reachable) are logged first, so memory starts at the start of the session.

## Consequences

Amends the v1 "start fresh" rule (ADR-0000). The first turn after switch-on of a long session waits
for those messages to be summarized.
