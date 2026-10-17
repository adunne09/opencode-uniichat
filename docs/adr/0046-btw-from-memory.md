# ADR-0046: /btw answers from memory

Accepted.

OpenCode's `/btw` sends the session's whole stored history, which in a UniiChat session grows until it is too long. UniiChat's generate hook sends Unii's prompt, the view and the current turn instead, and lets the model look things up with zoom and date first (`btw.lookupSteps`).
