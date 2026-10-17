# ADR-0019: Per-turn state format

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9: "follow the format OpenCode V2 uses")
- Spec: D19
- Deviation from the recipe: No: R§6 per-turn state, in OpenCode's format.

## Decision

The text block after the view reuses OpenCode's built-in renderings verbatim (`core/src/instructions/builtins.ts:21-52`): `Today's date: <Date.toDateString()>`, a blank line, then `Here is some useful information about the environment you are running in:` followed by the `<env>…</env>` block (working directory, workspace root, git repo yes/no, platform, temp-dir line). No git branch line (Q1, closed Oct 9: strict OpenCode format).
