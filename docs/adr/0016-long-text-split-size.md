# ADR-0016: Long-text split size

Accepted.

Text longer than 30,000 characters (other than tool output, which is clipped) is logged as several records in a row of at most 30,000 characters, split at the last newline before the limit when there is one.
