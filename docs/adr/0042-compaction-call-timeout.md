# ADR-0042: Time out hung compaction calls

Accepted.

A compaction call that never answered kept its turn waiting forever. Each call now times out after 4 minutes by default (`compaction.timeoutMs`) and is retried like any failed call.
