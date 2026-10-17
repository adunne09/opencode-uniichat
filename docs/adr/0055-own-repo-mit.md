# ADR-0055: Own repository with history; MIT license

- Status: Accepted
- Date: Oct 17, 2026
- Deviation from the recipe: Not covered by the recipe.

## Decision

This repository is the only copy. It was split out of the dotfiles repo with `git subtree split`,
keeping the plugin's history. The author's own OpenCode config loads it from a local checkout
(`<checkout>/src`, which hot-reloads); everyone else installs it from GitHub. It is MIT licensed so
anyone can fork, change and redistribute it.
