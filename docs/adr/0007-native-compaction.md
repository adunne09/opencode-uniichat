# ADR-0007: Native compaction

- Status: Accepted (refined by ADR-0051)
- Date: Oct 9, 2026
- Spec: D7
- Deviation from the recipe: Not covered by the recipe (OpenCode-specific).

## Decision

must not affect enabled sessions. (Revised Oct 9: V2 has no per-session switch; the hook's `options` become provider options and compaction settings are location-wide, §8.2.) Auto-compaction stays on. Its size estimate is anchored on the provider-measured size of the last request actually sent, so in an enabled session it fires only near a real overflow, or on the first step after `/unii on` in a nearly full vanilla session. The compaction hook returns a placeholder `result` for every native compaction (auto, overflow, `/compact`) of an enabled session, so none makes a model call. The context hook ignores OpenCode's compacted history anyway (D1). If a checkpoint cuts the current turn out of the hook's messages, the turn fails with a clear message (D8).
