# ADR-0040: Undo drops the undone turn

- Status: Accepted (refined by ADR-0050)
- Date: Oct 13, 2026 (user, Oct 13; amends §3 "never delete")
- Spec: D40
- Deviation from the recipe: Yes. R§1 says "Never edit or delete a line"; undone records are moved aside.

## Decision

OpenCode's `/undo` deletes the undone messages when the next prompt commits it. At each parent context step, records after the last one whose source is still in the session are rewound: those records, every tree node covering them and their `files/` are moved to `undone/<stamp>/`, views are cut (straddling lines open into children), the queue is rebuilt, and in-flight compactions over them are discarded. Ids are reused by the redo. The turn right after a single undo keeps its frozen view.
