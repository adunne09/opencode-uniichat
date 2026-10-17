# ADR-0048: Compaction effort high, not xhigh

- Status: Accepted
- Date: Oct 15, 2026
- Deviation from the recipe: Yes. R§4: "Claude Haiku at xhigh effort."

## Context

A merge in a long chat failed again and again with no text: Haiku at xhigh effort spent its whole
32,000-token output limit on thinking.

## Decision

The user: "Let's lower the compaction effort to high", with no fallback ladder for now, and see if it
happens again. Anthropic compaction calls use adaptive thinking at `high` effort. Since ADR-0054 this
is only the default (`compaction.providerOptions`, `compaction.variant`).
