# ADR-0041: Drop the per-chat OS lock

- Status: Accepted
- Date: Oct 11, 2026
- Deviation from the recipe: Yes. R§1: "One process owns a chat (hold a lock)."

## Context

ADR-0009 held an OS `flock` on `chat.lock` per chat, through `bun:ffi`, and failed the turn when the
lock was held elsewhere. A stale `chat.lock` blocked a session.

## Decision

The lock and `chat.lock` are removed. One OpenCode server process owns its chats in practice: every
chat is opened once per process through a registry, and writes go through one mutex per chat.

## Consequences

Two OpenCode server processes running UniiChat on the same session would both write to its log.
That is not guarded against. (The reason for dropping the lock was not written down at the time; the
stale lock left by a replaced plugin instance in the same server is the likely cause, unverified.)
