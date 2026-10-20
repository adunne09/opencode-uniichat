# ADR-0027: When system.txt is rendered

Superseded by [ADR-0063](0063-current-source-fidelity.md): refresh rules and the system at each new turn.

`/unii on` marks the chat for rendering; the next turn's first request builds `system.txt` from that request's system text, since the Code Mode catalog is only readable there. A subagent renders and freezes the parent's current view at its own first request.
