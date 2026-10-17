# ADR-0017: Compaction failure during the R§6 wait

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9: "follow the recipe; where it is unclear, keep retrying")
- Spec: D17
- Deviation from the recipe: No: a reading of R§4/R§6 where they are silent.

## Decision

The turn waits until every message before it is summarized. A failed call is retried at the next message (R§4); while a turn is waiting there is no next message, so failed calls are retried with backoff (1 s doubling, max 30 s) until they succeed. The turn stays blocked meanwhile, and the popup shows the failure.
