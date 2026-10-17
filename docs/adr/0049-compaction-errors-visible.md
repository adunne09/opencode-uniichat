# ADR-0049: Show compaction errors

- Status: Accepted
- Date: Oct 13-15, 2026
- Deviation from the recipe: Not covered by the recipe (UI).

## Decision

A reply with no text is reported with what is known about why. A compaction error shows in the
sidebar (" · compaction error (/unii)") as well as in the popup, and a stale error clears once the
failed nodes succeed.

## Consequences

Since ADR-0052, OpenCode does not report the stop reason or token counts of a call, so the message
names the usual causes instead.
