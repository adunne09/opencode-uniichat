# ADR-0013: CodeMode catalog

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D13
- Deviation from the recipe: Yes, part of the system-prompt deviation (D2).

## Decision

MCP and namespace tools reachable only through `execute` are listed in OpenCode's system instructions, not in the `execute` tool, whose description is static (`core/src/codemode/tool.ts:62-69`). The rendered catalog goes into `system.txt` after the R§5 prompt and before AGENTS.md, because it changes less often than AGENTS.md. It is frozen at `/unii on`; an MCP inventory change takes effect at the next `/unii on`. MCP server guidance (`<mcp_instructions>`), skills and references stay out (D2).
