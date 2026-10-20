# ADR-0048: Compaction effort high, not xhigh

Accepted. Deviates from the recipe.

At xhigh effort Haiku sometimes spent its whole output limit thinking and returned no text. Compactions use the `high` variant instead; it is only a default (`compaction.variant`). The released UniiChat code also uses Haiku at `high`.
