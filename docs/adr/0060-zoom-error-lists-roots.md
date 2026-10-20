# ADR-0060: A bad zoom lists the tree's roots

Accepted. Follows the released UniiChat code.

A zoom with an invalid id or n fails with the rule (n a power of 2, id a multiple of n, inside the chat) and the tree's current roots, so the model can retry from a valid line.
