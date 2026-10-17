# ADR-0020: Subagent reports in the request

Accepted.

A subagent's completion message is replaced in the request by one text part, `[Name] <report>`, the same text as its `work` record, so the request matches the log. No session id or other state is added.
