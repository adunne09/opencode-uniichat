# ADR-0010: zoom and date are global tools, hidden from vanilla sessions

- Status: Accepted
- Date: Oct 9, 2026
- Spec: D10
- Deviation from the recipe: No.

## Decision

`zoom` and `date` are registered globally with `ctx.tool.transform` (V2 has no per-session registration) and removed in the context hook for disabled sessions, so the model in a vanilla session never sees them. Register them with `options: { codemode: false }` so they are direct tools and never enter the CodeMode catalog.
