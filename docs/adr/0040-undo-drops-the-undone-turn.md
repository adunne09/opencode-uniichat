# ADR-0040: Undo drops the undone turn

Accepted, refined by ADR-0050. Deviates from the recipe.

The recipe never deletes a line, but OpenCode's `/undo` deletes messages, and memory should not keep what the user took back. Records whose messages are gone from the session, and every summary covering them, are moved to an `undone/` folder, the views are cut back and pending compactions over them are dropped.
