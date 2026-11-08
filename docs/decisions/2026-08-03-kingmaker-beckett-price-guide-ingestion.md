# Decision: Beckett is a private dated-pricing source

## Status

Accepted for implementation.

## Decision

KINGMAKER will ingest Beckett guide rows into a dedicated private staging and review layer. Beckett values become dated `book_value_low` and `book_value_high` observations only after validation. The Checklist Registry remains the canonical identity source, and verified sold comps remain the primary live-market source.

## Consequences

- No guide row can create or override a canonical card identity by itself.
- OCR values are never promoted automatically.
- Original PDFs and extraction bundles remain private and are excluded from the public repository.
- Every promoted value retains guide edition, page, source-row hash, and identity linkage.
- Monthly editions append observations rather than overwriting history.
