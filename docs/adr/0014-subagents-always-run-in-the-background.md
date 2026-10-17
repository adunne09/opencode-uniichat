# ADR-0014: Subagents always run in the background

Accepted.

In enabled sessions every subagent call is made a background call, so the agent never waits, as the recipe requires. The finished report arrives as a message and is logged as one `work` record, `[Name] <report>`.
