# ADR-0054: Everything tunable is an option

Accepted.

Switch default, compaction model and settings, view budgets, `/btw` lookups, prompts (as strings) and TUI refresh are plugin options, defaulting to the recipe's values. The 512-byte line limit and the file formats stay fixed, since changing them would break existing memories.
