# ADR-0002: System prompt

Accepted. Deviates from the recipe.

The recipe's prompt, agent name "Unii", without the paragraph about the user's devices, since tools run locally. It is followed by the Code Mode catalog (ADR-0013), the skills list (ADR-0045) and AGENTS.md, and replaces OpenCode's own system prompt. It holds no date, directory or other state, is rendered once at `/unii on`, saved as `system.txt` and never changes; edits take effect at the next `/unii on`.
