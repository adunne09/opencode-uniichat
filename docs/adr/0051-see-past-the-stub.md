# ADR-0051: See past UniiChat's own compaction placeholder

Accepted.

OpenCode can compact a session unexpectedly, for example after a switch to another provider's model, and the placeholder from ADR-0007 can cut the running turn out of the request. The placeholder is tagged, and when it falls inside the current turn the turn is rebuilt from the full message list instead of failing. Only a real checkpoint still fails the turn.
