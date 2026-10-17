# ADR-0021: View size

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D21
- Deviation from the recipe: No.

## Decision

Every byte budget (128/64 KB chat view, 32/16 KB compaction view) is the sum of UTF-8 bytes of the rendered lines `id+n|text` plus one newline each, without the `<chat>` tags. Placeholder lines count as rendered.
