# ADR-0042: Time out hung compaction calls

- Status: Accepted
- Date: Oct 11, 2026
- Deviation from the recipe: No: the recipe is silent on hung calls.

## Context

A compaction call that never answered (no response, stalled stream) kept a node in flight forever, so
the turn waiting in R§6 for every earlier message to be summarized hung too.

## Decision

Each compaction call has a timeout, 4 minutes by default (option `compaction.timeoutMs`). A call
that times out fails like any other failed call and is retried per R§4 and ADR-0017.
