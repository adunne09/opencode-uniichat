# ADR-0009: Storage

- Status: Amended by ADR-0041 (lock dropped)
- Date: Oct 9, 2026
- Spec: D9
- Deviation from the recipe: Amended by [ADR-0041](0041-drop-chat-lock.md): no lock, against R§1 "hold a lock".

## Decision

the recipe's files (R§1) under `<opencode data dir>/uniichat/<sessionID>/`, with one OS file lock per chat (R§1 "hold a lock").
