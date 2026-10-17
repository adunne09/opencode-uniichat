# ADR-0010: zoom and date are global tools, hidden from vanilla sessions

Accepted.

OpenCode cannot register a tool for one session, so `zoom` and `date` are registered globally as direct tools (never inside Code Mode) and removed from the request of sessions that are off.
