# ADR-0020: Subagent reports in the request

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9; revised Oct 9: recipe-strict)
- Spec: D20
- Deviation from the recipe: No.

## Decision

In enabled sessions the context hook replaces the content of each subagent-completion synthetic message (metadata `source: "subagent"`) with one text part, `[Name] <report>`, exactly the `work` record's text, so the request matches the log and the R§5 prompt ("a message starting \"[Name]\""). The message keeps its id (turn slicing, §5). `<report>` is the text between the wrapper's first and last lines, i.e. OpenCode's report, error text or "Subagent cancelled". No sessionID or state is added, and the subagent tool's result is left as OpenCode renders it (no Name in it), so the master cannot map a Name to a child sessionID. If the report was split (D16), the request carries the whole report in one part; only the log is paged.
