# ADR-0034: Leaf rule is strict

- Status: Accepted
- Date: Oct 9, 2026 (Q6, approved Oct 9)
- Spec: D34
- Deviation from the recipe: No.

## Decision

R§4's "fewer than 8 earlier lines unbuilt" applies to every leaf, including ones that fit in 512 bytes; those then complete instantly and take no call slot.
