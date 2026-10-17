# ADR-0054: Everything tunable is a plugin option

- Status: Accepted
- Date: Oct 17, 2026
- Deviation from the recipe: No by default: every default is the recipe's value or the behavior before options existed.

## Decision

The user: "I want all options that you sent. I want to make it as configurable as possible." Options
come from the plugin's `options` in `opencode.json(c)` and are validated at load (`src/options.ts`):
switch default, compaction model, variant, output limit, provider options, timeout, "Too long" tries,
concurrency, both view budgets, `/btw` lookups, prompts, and TUI refresh and sidebar. Prompts are given
as strings, not file paths.

Kept fixed: the 512-byte node limit and ruler (changing them would corrupt existing memories), the
log/tree formats and the placeholder compaction's format.

## Consequences

Setting a value away from the recipe's default is a deviation the user takes on. A prompt change
reaches a session at its next `/unii on`, since `system.txt` is frozen (ADR-0002).
