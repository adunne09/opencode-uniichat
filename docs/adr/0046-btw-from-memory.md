# ADR-0046: /btw answers from Unii's memory

- Status: Accepted
- Date: Oct 13, 2026
- Deviation from the recipe: Not covered by the recipe (OpenCode's /btw side question).

## Context

OpenCode's `/btw` runs one `session.generate` call on the session's whole stored history. In a
UniiChat session that history keeps growing (native compaction is skipped, ADR-0007), so `/btw` failed
with "prompt too long".

## Decision

The user: "add a generate hook and give it access to zoom tool as well." UniiChat's `generate` hook
replaces the request with Unii's system prompt, the view and the raw turn in progress. Before the
answer, the model may open memory with `zoom`/`date` in a short lookup loop (option `btw.lookupSteps`);
what it opened is added to the question.

## Consequences

Lookups were Anthropic-only at first, as direct API calls with tools. ADR-0052 moved them to a text
protocol that works with any provider.
