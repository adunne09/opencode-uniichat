# ADR-0009: Storage

Amended by ADR-0041.

Each chat keeps the recipe's files in `<OpenCode data dir>/uniichat/<sessionID>/`. It originally held an OS file lock per chat; ADR-0041 removed it.
