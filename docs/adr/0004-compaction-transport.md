# ADR-0004: Compaction transport

- Status: Superseded by ADR-0052
- Date: Oct 9, 2026
- Spec: D4
- Deviation from the recipe: Not covered by the recipe. Superseded by [ADR-0052](0052-model-calls-through-opencode.md).

## Decision

a plugin-owned direct Anthropic Messages adapter, because `ctx.generate.text` only accepts `{prompt, model}` (§7). It uses the active Claude Pro/Max OAuth credential and reuses `anthropic-auth`'s Claude Code request rewrite. Built on `@opencode/ai/promise` (the same library and version that lowers turns) with an executor middleware that applies the shared rewrite, so lowering, cache-mark policy and usage parsing match turns (spike in §8.6).
