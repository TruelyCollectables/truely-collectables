# TCOS Market Intel™ Discovery Bulk Review Chunks

Bulk Discovery approval and rejection are processed by the browser in committed chunks of three candidates.

This avoids running up to 50 identity creation, listing ingestion, scoring, and candidate-update workflows inside one Vercel serverless invocation.

The toolbar displays live processed, approved, rejected, and skipped counts. Completed chunks remain committed if a later chunk fails.
