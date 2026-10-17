# ADR-0008: Raw-turn overflow

- Status: Accepted
- Date: Oct 9, 2026
- Spec: D8
- Deviation from the recipe: No (the recipe has no mechanism either).

## Decision

no extra mechanism. If one turn outgrows the context window, the request fails and the user is told.
