# ADR-0016: Long-text split size

- Status: Accepted
- Date: Oct 9, 2026 (approved Oct 9)
- Spec: D16
- Deviation from the recipe: No: R§1 "logged as several messages in a row"; only the size is chosen here.

## Decision

Non-tool text longer than 30,000 characters is logged as several records in a row of at most 30,000 characters each, split at the last newline before the limit when there is one.
