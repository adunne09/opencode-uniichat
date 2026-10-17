# ADR-0052: Model calls through OpenCode's providers

Accepted. Deviates from the recipe.

So that anyone can use the plugin with their own providers and credentials, each compaction call and `/btw` lookup runs in a throwaway child session whose request UniiChat replaces through the generate hook, keeping the system prompt, cache marks and tools. Any model can compact (`compaction.model`, newest Claude Haiku by default). OpenCode returns only text, so token usage and cost are no longer shown, and `/btw` lookups are written as `zoom(...)` and `date(...)` lines that UniiChat answers.
