# ADR-0047: Browse the view in the /unii popup

- Status: Accepted
- Date: Oct 13, 2026
- Deviation from the recipe: Not covered by the recipe (UI).

## Context

The popup's Archive tab took typed ids, which the user found clumsy, and a long view was cut off,
stuck to the bottom and overflowed the session.

## Decision

The user: "go over the list, click, say, Enter to zoom in, Escape to zoom out or close the tool." The
popup fits the terminal and lists the view's lines; Up/Down/PgUp/PgDn/Home/End move, Enter or a click
zooms into a line, Escape goes back a level and then closes. Its keys are a modal layer, so they no
longer scroll the session behind it.
