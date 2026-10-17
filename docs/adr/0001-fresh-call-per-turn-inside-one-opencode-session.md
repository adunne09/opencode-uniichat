# ADR-0001: Fresh call per turn inside one OpenCode session

- Status: Accepted
- Date: Oct 9, 2026
- Spec: D1
- Deviation from the recipe: Yes. R§6 calls each turn "in a fresh session"; here the OpenCode session stays and only its request is rebuilt.

## Decision

The recipe says "in a fresh session". We keep the OpenCode session as UI and transcript, and the context hook sends only `[tools][system][view][per-turn state][new message]` plus the current turn's raw steps. Earlier raw turns are dropped. The persisted transcript is untouched, so native scrollback still works.
