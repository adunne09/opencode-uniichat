# ADR-0025: Shell messages

- Status: Accepted
- Date: Oct 9, 2026 (Q2, closed Oct 9)
- Spec: D25
- Deviation from the recipe: Yes, minor: user-run shell commands are not logged.

## Decision

User-run shell commands (`shell` messages) are not logged. They stay in the current turn's request as OpenCode renders them.
