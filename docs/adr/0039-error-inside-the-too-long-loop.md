# ADR-0039: Error inside the "Too long" loop

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D39
- Deviation from the recipe: No.

## Decision

If a later try fails (API error, or no text block per D33), the loop stops and the node is built from the shortest line received so far. The node fails (R§4, D17) only if no line was received.
