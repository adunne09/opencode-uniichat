# ADR-0039: Error inside the "Too long" loop

Accepted.

If a retry for a too-long line fails, the loop stops and keeps the shortest line received so far. The node fails only if no line was received.
