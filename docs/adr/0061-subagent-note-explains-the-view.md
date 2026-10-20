# ADR-0061: The subagent note explains the view

Accepted. Follows the released UniiChat code.

The note added to a subagent's own prompt (ADR-0015) now explains the memory the way the released code's view docs do: the item kinds, that no message appears in full, to follow the task rather than the user's last message, and to zoom whenever a summary only mentions something needed. A subagent that misreads summaries as whole messages, or redoes the user's whole request, wastes the task.
