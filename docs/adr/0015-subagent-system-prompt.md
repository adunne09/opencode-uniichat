# ADR-0015: Subagent system prompt

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9; revised Oct 12: "Keep the subagent's own system prompt")
- Spec: D15
- Deviation from the recipe: Yes. R§6 makes a subagent a fresh call with the view first; it does not give it its own system prompt.

## Decision

A UniiChat subagent keeps OpenCode's system text for its agent (e.g. explore's prompt plus instructions), plus one appended part `SUBAGENT_NOTE` (prompts.ts) saying the `<chat>` view is context for its task and to end with a report. It no longer gets `system.txt`: with the Unii prompt, children (seen on gpt-6-luna explore) took their task for a compaction and replied with one summary line. Its first message is still the view, then its task (R§6).
