# ADR-0023: Record formats

Accepted.

A `tool` record is `name {json input}`; an `echo` record is the result text, prefixed `error: ` on failure. Attachments add one line each pointing at the saved file. `zoom(id, n)` returns the two child lines, `zoom(id, 1)` the whole message with its images, `zoom("Name")` the agent's log. `date(id)` is local time with offset and weekday. zoom output is never truncated by OpenCode.
