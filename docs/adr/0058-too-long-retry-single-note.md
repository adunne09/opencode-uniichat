# ADR-0058: "Too long" retries resend the first request with one note

Accepted. Revises the recipe's "same conversation". Follows the released UniiChat code.

Each retry sends the first request with only a note on the last line appended, worded as in the released code. Earlier tries' replies are never sent back, so a retry costs the same as the first try and reuses its cache.
