# ADR-0006: Switch

- Status: Accepted
- Date: Oct 9, 2026
- Spec: D6
- Deviation from the recipe: Yes. The recipe has one chat that never ends; here it is per session and switchable.

## Decision

`/unii on` and `/unii off`, per session, default OFF, taking effect at the next idle-to-active turn. OFF means vanilla context, prompt, tools, cache policy and native compaction. The chat's files are kept. While OFF nothing is logged; ON resumes the same chat.
