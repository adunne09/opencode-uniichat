# ADR-0007: Native compaction

Accepted, refined by ADR-0051.

OpenCode's compaction must not touch a UniiChat session, and cannot be disabled per session. So for every native compaction of an enabled session the compaction hook returns a placeholder result and no model is called; the request is rebuilt from the view anyway. Because OpenCode sizes context from the last request actually sent, this rarely fires.
