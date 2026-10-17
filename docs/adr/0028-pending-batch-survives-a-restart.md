# ADR-0028: Pending batch survives a restart

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D28
- Deviation from the recipe: No.

## Decision

`view.json` and `compaction-view.json` stay `[[l, i], ...]`. A batch that could not finish (built parents ran out) is recorded in `view-batch.json`, `{"chat": bool, "compaction": bool}`, written temp + rename with the views, so it resumes at the next message after a restart.
