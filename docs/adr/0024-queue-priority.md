# ADR-0024: Queue priority

Accepted.

When a call slot frees, ready leaves go first, oldest first, then ready merges, oldest first. A waiting turn depends only on leaves.
