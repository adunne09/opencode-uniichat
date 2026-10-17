# ADR-0014: Subagents always run in the background

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D14
- Deviation from the recipe: No: it implements R§6 "the master never waits or polls".

## Decision

In enabled sessions a `tool` `execute.before` hook sets `background: true` on `subagent` calls, so the master never waits (R§6). The completion arrives as a steered `synthetic` message and is logged as one `work` record `[Name] <report>`.
