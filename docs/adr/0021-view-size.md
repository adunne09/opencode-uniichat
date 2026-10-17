# ADR-0021: View size

Accepted.

The view budgets (128/64 KB chat view, 32/16 KB compaction view) count the UTF-8 bytes of the rendered `id+n|text` lines plus one newline each, without the `<chat>` tags.
