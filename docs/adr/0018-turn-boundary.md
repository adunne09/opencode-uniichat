# ADR-0018: Turn boundary

Accepted.

A turn is everything after the last time the session went idle. Its first request renders and freezes the view; every later request until the next idle continues the turn, including after a message sent while it runs.
