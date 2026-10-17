# ADR-0037: zoom schema

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D37
- Deviation from the recipe: No.

## Decision

Input `{id: integer \| string, n?: integer}`. The tool description is the R§6 string verbatim. A string `id` is an agent Name and returns `agents/<Name>.jsonl` (R§5, R§6).
