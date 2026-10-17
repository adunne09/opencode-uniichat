# ADR-0006: On/off switch per session

Accepted. Deviates from the recipe.

`/unii on` and `/unii off` switch a session, off by default, from the next turn. Off means plain OpenCode: its context, prompt, tools, caching and compaction. Nothing is logged while off, the chat's files are kept, and switching on again resumes the same chat.
