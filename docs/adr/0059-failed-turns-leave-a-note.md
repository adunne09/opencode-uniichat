# ADR-0059: Failed and stopped turns leave a note

Accepted. Follows the released UniiChat code.

An assistant message that ended in an error is logged with a `note` after it: "No reply: <error>. Send a message to try again.", or "Stopped: this turn was interrupted." when it was stopped. Memory then knows a turn ended without a reply.
