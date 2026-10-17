# ADR-0017: Compaction failure while a turn waits

Accepted.

A turn waits until every earlier message is summarized. The recipe retries a failed call at the next message, but a waiting turn has no next message, so failed calls are retried with backoff (1 s, doubling, at most 30 s) until they succeed. The popup shows the failure meanwhile.
