# ADR-0037: zoom schema

Amended by [ADR-0063](0063-current-source-fidelity.md): default n to one and add character-offset pagination.

`zoom` takes `{id: integer | string, n?: integer}` with the recipe's description. A string id is an agent name and returns that agent's log.
