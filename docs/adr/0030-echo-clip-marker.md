# ADR-0030: Echo clip marker

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D30
- Deviation from the recipe: No: R§1 head and tail, 30,000 characters.

## Decision

A clipped tool output is a 15,000-character head, `\n[… N characters clipped …]\n`, and a 15,000-character tail. The marker is not counted in the 30,000.
