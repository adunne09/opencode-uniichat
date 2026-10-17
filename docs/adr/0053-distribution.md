# ADR-0053: Install from GitHub; ship the TUI prebuilt

Accepted.

The plugin is installed with `opencode plugin add github:maxandron/opencode-uniichat`. The server part ships as TypeScript and borrows OpenCode's own `effect` and plugin API. OpenCode does not compile TSX inside `node_modules`, so the TUI ships as `dist/tui.js`, built by `scripts/build-tui.ts`, and a test fails if it is stale.
