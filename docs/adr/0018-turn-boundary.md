# ADR-0018: Turn boundary

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9, replaces the first-step rule formerly in §5)
- Spec: D18
- Deviation from the recipe: No: maps R§6 turns onto OpenCode.

## Decision

A turn is everything after the last `idle` marker. Its first step is the first context-hook call that sees the first input after that marker; it waits, renders and freezes the view. Every later hook call until the next `idle` is a continuation, including those that follow a steered message. Steering never resets a turn.
