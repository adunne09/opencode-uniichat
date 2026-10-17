# ADR-0052: Model calls through OpenCode's providers

- Status: Accepted
- Date: Oct 17, 2026
- Deviation from the recipe: Yes, partly: R§4 names Claude Haiku; any model OpenCode can call may now compact, Haiku stays the default.

## Context

ADR-0004 called Anthropic directly with a Claude Pro/Max OAuth token from a separate auth plugin. To
share the plugin, it must use whatever providers and credentials each user has set up in OpenCode.
OpenCode gives plugins `ctx.generate.text` (one prompt string: no system prompt, cache marks, tools
or options, so compactions would cost several times more) and `ctx.session.generate`.

## Decision

Option B. Each compaction call, and each `/btw` lookup step, runs in a throwaway child session of the
chat's session (so it shares the chat's cache key): UniiChat calls `session.generate` on it, its
`generate` hook replaces the system prompt, messages (with the recipe's cache marks), tools and
options with the prepared request, and the session is removed afterwards. While a compaction call
runs, an `http.response` hook scoped to its provider notes when the response headers arrive, so calls
that share a cache prefix still wait for the first to start (R§3.3).

## Consequences

- Any provider, API key or auth plugin works. The compaction model is an option (ADR-0054); by default
  the newest Anthropic Claude Haiku.
- OpenCode's generate API returns text only: no token usage, cost or stop reason. The popup shows call
  counts and times instead of cache reads and cost.
- `/btw` lookups cannot use tool calls, so the model writes `zoom(id, n)` / `date(id)` lines and
  UniiChat answers them; this works with any provider (it was Anthropic-only before).
- The throwaway session gets the tools OpenCode offers it, filtered to the chat's tool names and order.
  If they differ from the chat's, the compaction misses the turns' cache prefix.
- The throwaway session may show briefly as a child session.
