# ADR-0033: Compaction reply

- Status: Accepted
- Date: Oct 9, 2026 (Q5, approved Oct 9)
- Spec: D33
- Deviation from the recipe: No.

## Decision

The line is the final text block with surrounding whitespace trimmed. A reply with no text block (e.g. only a tool call) is a failed call, retried per R§4/D17.
