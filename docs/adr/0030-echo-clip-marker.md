# ADR-0030: Clip marker for tool output

Accepted.

Clipped tool output keeps a 15,000-character head and a 15,000-character tail around a `[... N characters clipped ...]` marker, which does not count toward the 30,000.
