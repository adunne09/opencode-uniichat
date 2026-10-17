# ADR-0035: Where </chat> goes

Accepted.

The view is sent as whole 4-line blocks, then one part with the 0-3 leftover lines and `</chat>`. The cache mark sits on the last whole block, so it stays a stable prefix.
