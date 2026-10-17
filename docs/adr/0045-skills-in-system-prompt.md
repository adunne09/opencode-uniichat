# ADR-0045: OpenCode's skills list in the system prompt

- Status: Accepted
- Date: Oct 12, 2026
- Deviation from the recipe: Yes, part of the system-prompt deviation (ADR-0002).

## Context

ADR-0002 kept OpenCode's skills list out of `system.txt`, so Unii could not see or use the skills
installed in OpenCode.

## Decision

OpenCode's skills section goes into `system.txt` between the Code Mode catalog and AGENTS.md, frozen
at `/unii on` like the catalog. User-invoked `skill` messages are logged as `user` messages.

## Consequences

Sessions switched on earlier keep their old `system.txt` until `/unii on` is run again.
