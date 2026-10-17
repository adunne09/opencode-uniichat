# ADR-0043: Import earlier turns on first switch-on

Accepted. Deviates from the recipe.

Switching a session on mid-way used to leave Unii with no memory of what came before. When a session is first switched on, its earlier turns are logged as ordinary messages rather than as the recipe's `note` memories, so memory starts at the start of the session. The first turn waits for them to be summarized.
