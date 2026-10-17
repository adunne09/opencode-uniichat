# ADR-0035: `</chat>` placement

- Status: Accepted
- Date: Oct 9, 2026 (Q7, approved Oct 9)
- Spec: D35
- Deviation from the recipe: No.

## Decision

The view is sent as whole 4-line blocks (the first prefixed `<chat>\n`), then one final part with the 0-3 leftover lines and `</chat>`. The cache mark sits on the last whole block, which therefore stays a stable prefix. Applies to the chat view and the compaction view.
