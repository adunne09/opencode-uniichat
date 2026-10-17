# ADR-0027: system.txt timing

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9, refines D2/D13)
- Spec: D27
- Deviation from the recipe: No.

## Decision

`/unii on` stores `{on: true, render: true}` in `ctx.storage`. The next first step (D18) renders `system.txt` from that hook call's system text (the CodeMode catalog is only readable there), saves it, and clears `render`. **Subagent views** (approved Oct 9, refines D15): each child turn renders and freezes the parent's current view at its own first step, by the D18 rule applied to the child session.
