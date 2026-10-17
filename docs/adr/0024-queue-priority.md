# ADR-0024: Queue priority

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D24
- Deviation from the recipe: No.

## Decision

When a call slot frees, ready leaves go first, oldest first, then ready merges, oldest first. The R§6 wait depends only on leaves.
