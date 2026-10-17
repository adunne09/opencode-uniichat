# ADR-0051: See past UniiChat's own compaction stub, without OpenCode changes

- Status: Accepted
- Date: Oct 17, 2026
- Deviation from the recipe: Not covered by the recipe (OpenCode-specific); refines ADR-0007.

## Context

A session hit a provider block, was undone and switched to another provider's model. OpenCode then
estimated the context size from the raw history from message 1 (no measured reply for the new
provider), compacted natively, and UniiChat's placeholder compaction (ADR-0007) cut the running turn
out of the hook's messages: "UniiChat turn cut by an OpenCode compaction checkpoint".

Options: an OpenCode option to skip compaction for a session (needs upstream changes), turning
`compaction.auto` off globally (affects vanilla sessions), or recognizing UniiChat's own placeholder.

## Decision

The user: "I don't want upstream changes." The placeholder is tagged (`metadata.uniichat =
"skipped"`). When it falls inside the current turn, the turn is rebuilt from OpenCode's full message
list, as OpenCode would have sent it, instead of failing. Only a real checkpoint, or an unreachable
message list, still fails the turn.
