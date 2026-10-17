# ADR-0026: Frozen render in memory only

- Status: Accepted
- Date: Oct 9, 2026 (Q3, closed Oct 9)
- Spec: D26
- Deviation from the recipe: No.

## Decision

After a server restart mid-turn, the rest of that turn renders the current view (one cache miss). No extra file.
