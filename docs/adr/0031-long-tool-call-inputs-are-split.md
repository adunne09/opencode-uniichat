# ADR-0031: Long tool-call inputs are split

Accepted.

Only tool output is clipped. Tool-call records longer than 30,000 characters are split like other long text.
