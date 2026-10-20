# ADR-0024: Queue priority

Superseded by [ADR-0063](0063-current-source-fidelity.md): endpoint order, merges first at ties, configurable 64-job default.

When a call slot frees, ready leaves go first, oldest first, then ready merges, oldest first. A waiting turn depends only on leaves.
