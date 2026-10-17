# ADR-0000: Follow the recipe; one OpenCode session is one chat

- Status: Accepted
- Date: Oct 8, 2026
- Deviation from the recipe: Yes, in scope: the recipe has one chat for the agent's whole life; here each OpenCode session is its own chat.

## Context

UniiChat is an implementation of Victor Taelin's [UniiChat recipe](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449)
(baseline revision `3c190e06f34aba0c69f49042c526093269604935`, Oct 8, 2026) on OpenCode v2.

## Decision

- The recipe is king. Read it whole before changing code. Deviate only for a very good reason, with
  the user's explicit approval, and record each approved deviation as an ADR here.
- Recipe sections are cited as `R§n`. `§n` (without R) refers to sections of the original v1 design
  spec, which these ADRs replace.
- v1 scope: the vanilla recipe inside one OpenCode session. One session is one chat, keyed by session
  ID; another session, even in the same project, starts its own chat. No sharing, branches, merging or
  synchronization. Everything in R§1-R§7: log, tree, view, compactions, prompt, turns, subagents,
  cache marks. A per-session on/off switch returns a session to vanilla OpenCode.
- v1 started fresh, with no import of earlier OpenCode history (changed by ADR-0043).
