# ADR-0005: Cache marks

- Status: Accepted
- Date: Oct 9, 2026
- Spec: D5
- Deviation from the recipe: Yes, minor: OpenCode may add up to two cache marks of its own.

## Decision

the recipe's marks (last whole 4-line block of the view, end of request) are placed manually. OpenCode's automatic policy cannot be turned off from the context hook and may add up to two more marks on the stable tools/system prefix. Accepted.
