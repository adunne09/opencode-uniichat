# ADR-0001: Fresh call per turn inside one OpenCode session

Accepted. Deviates from the recipe.

The recipe starts each turn in a fresh session. Here the OpenCode session stays, as UI and transcript, and only its request is rebuilt: tools, system prompt, view, per-turn state, the new message and the current turn's raw steps. Earlier raw turns are left out of the request but kept in the transcript, so scrollback still works.
