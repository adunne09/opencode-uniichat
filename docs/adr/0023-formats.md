# ADR-0023: Formats

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D23
- Deviation from the recipe: No: formats the recipe leaves open.

## Decision

`tool` record: `name {json input}`. `echo` record: the result text; error results are prefixed `error: `. Attachments: an extra line per file, `[file: <name> <mime> → files/<i>-<k>.<ext>]`, or `[file: <name> <mime>, not available]`. `zoom(id, n>1)`: the two child lines as `id+n|text`. `zoom(id, 1)`: `kind: text` plus its images. "A long message comes in pages" means the D16 split records. `zoom("Name")`: the agent log as `i|kind: text` lines. `zoom` results set `metadata: {truncated: false}` so OpenCode's 2,000-line / 50 KB truncation does not apply (`core/src/tool-output.ts:67-70`). `date(id)`: `YYYY-MM-DD HH:MM:SS ±HH:MM (Weekday)` in local time.
