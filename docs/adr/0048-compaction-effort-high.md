# ADR-0048: Compaction effort high, not xhigh

Accepted. Deviates from the recipe.

At xhigh effort Haiku sometimes spent its whole output limit thinking and returned no text. Compactions on Anthropic models use high effort instead; it is only a default (`compaction.providerOptions`).
