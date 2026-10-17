# ADR-0038: Effect-native code

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9, amends D4 and §8b.6)
- Spec: D38
- Deviation from the recipe: No (implementation).

## Decision

The server plugin uses `@opencode/plugin/effect`. The compaction adapter uses `@opencode/ai`'s Effect client (`AIClient.layerWith(RequestExecutor.middleware(fn))` / `LLMClient.Service`) instead of `make` from `@opencode/ai/promise`; same library, version and lowering. Type check: a plugin-local `plugins/uniichat/tsconfig.json`.
