# ADR-0015: Subagents keep their own system prompt

Accepted. Deviates from the recipe.

A subagent gets its OpenCode agent's own system prompt plus a short note that the `<chat>` view is context for its task and that it should end with a report. With the Unii prompt, subagents mistook their task for a compaction and replied with one summary line. Its first message is still the view, then the task.
