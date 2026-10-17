# ADR-0053: Distribute as a GitHub package; ship the TUI prebuilt

- Status: Accepted
- Date: Oct 17, 2026
- Deviation from the recipe: Not covered by the recipe (packaging).

## Context

The plugin lived in a dotfiles repo and was shared as a zip. The user wanted a public repo a colleague
can install and update.

## Decision

- GitHub only for now: `opencode plugin add github:maxandron/opencode-uniichat`. No npm.
- No auth plugin ships with it: Anthropic users have an API key or their own auth plugin (ADR-0052).
- The server part ships as plain TypeScript (Bun runs `.ts` from `node_modules`). `effect` and
  `@opencode/plugin` are optional peer dependencies, because OpenCode lends plugins its own copies.
- The TUI part ships prebuilt as `dist/tui.js`: OpenCode's load-time Solid transform skips files under
  `node_modules`, and a bare `solid-js` import there would load a second Solid. `scripts/build-tui.ts`
  compiles it the way OpenCode compiles local plugins (imports become `opentui:runtime-module:` ids),
  checks that every import is one OpenCode provides, and `bun test` fails if the committed file is
  stale. No `prepare` script, so installing needs no build tools.
