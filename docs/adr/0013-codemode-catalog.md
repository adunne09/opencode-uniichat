# ADR-0013: Code Mode catalog in the system prompt

Accepted. Deviates from the recipe.

Tools reachable only through Code Mode's `execute` are listed in OpenCode's system prompt, not in a tool. That catalog is copied into `system.txt` after the recipe's prompt and frozen at `/unii on`, so a change of installed MCP tools takes effect at the next `/unii on`.
