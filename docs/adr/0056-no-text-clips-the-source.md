# ADR-0056: A compaction with no text uses its source clipped

Accepted. Supersedes the no-text part of ADR-0033. Follows the released UniiChat code.

A compaction that answered with no line (a refusal, or thinking that used the whole output limit) failed and was retried, but asking again fails the same way, so the node stayed failed and blocked turns. Such a node now takes its source, newlines flattened, cut to 512 bytes, and a warning is logged. Errors and timeouts still fail and are retried.
