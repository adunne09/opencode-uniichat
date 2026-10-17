# ADR-0036: Merge task placeholders

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D36
- Deviation from the recipe: No.

## Decision

In the R§4 merge task, `{a}` and `{b}` are the view names `id+n` (e.g. `40+4`, `44+4`); `{id} to {end}` are the first and last message ids, inclusive (`40 to 47`). In the leaf task, `{id}` is the bare message id.
