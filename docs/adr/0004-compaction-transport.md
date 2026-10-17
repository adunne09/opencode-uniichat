# ADR-0004: Compaction transport

Superseded by ADR-0052.

Compaction calls went straight to Anthropic's API with the user's Claude subscription credentials, because OpenCode's simple text API cannot send a system prompt, cache marks or tools.
