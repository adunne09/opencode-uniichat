# ADR-0002: System prompt

- Status: Accepted (amended Oct 9 and Oct 12; see ADR-0045)
- Date: Oct 9, 2026
- Spec: D2
- Deviation from the recipe: Yes. R§5 prompt minus the devices paragraph, plus OpenCode's Code Mode catalog, skills list and AGENTS.md.

## Decision

R§5 verbatim, agent name "Unii", with the devices paragraph removed ("The user's computers that have unii open now..."), because OpenCode tools run locally. It is followed by the user's instructions (AGENTS.md content only; no skills list or MCP server guidance) and replaces OpenCode's base prompt for enabled sessions. No date, cwd or other state goes in it. It is rendered once at `/unii on`, saved with the chat (`system.txt`), and never changes after that (recipe-strict). Edits to AGENTS.md take effect at the next `/unii on`. OpenCode's mid-session instruction-update `system` messages are not forwarded. (Amended Oct 9, see D13: the CodeMode catalog goes between R§5 and AGENTS.md.) Order in `system.txt`: R§5 prompt, CodeMode catalog, AGENTS.md text. (Amended Oct 12: OpenCode's skills section goes between the catalog and AGENTS.md, frozen at `/unii on` like the catalog; user-invoked `skill` messages are logged as `user` items.) Built-in system additions (model identity "# Your Model", the worktree hint, Anthropic prompt appendix) are dropped with the rest of OpenCode's system.
