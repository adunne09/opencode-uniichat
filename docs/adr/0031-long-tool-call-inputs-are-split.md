# ADR-0031: Long tool-call inputs are split

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9, refines D16 by R§1)
- Spec: D31
- Deviation from the recipe: No.

## Decision

Only `echo` is clipped. `tool` records longer than 30,000 characters are split like other text; src `<toolCallID>:call:<k>`. Every non-echo src carries its split index.
