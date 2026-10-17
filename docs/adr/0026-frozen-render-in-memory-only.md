# ADR-0026: Frozen view in memory only

Accepted.

The view frozen for a turn is kept only in memory. After a server restart mid-turn, the rest of the turn uses the current view, at the cost of one cache miss.
