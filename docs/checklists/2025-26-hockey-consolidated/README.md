# 2025-26 Hockey Consolidated Checklist Batch

Tracking issue: #572

## Goal

Build one consolidated XLSX workbook containing every officially published 2025-26 hockey checklist in scope while preserving each product as a distinct Checklist Registry release.

## Source boundary

- Primary source: official Upper Deck checklist archive and official product checklist pages.
- Include NHL, PWHL, AHL, CHL, CHL Game Used, team, and centennial hockey products explicitly branded 2025-26 when an official checklist exists.
- Exclude 2026-27 products, generic 2026 event sets, and announced products without a published checklist.
- Preserve source URL, source title, publication date, retrieval timestamp, source hash, and parser version.

## Workbook design

One XLSX file with:

1. `Release Index` — one row per distinct product/release.
2. `Cards` — normalized card records keyed by release ID.
3. `Printings` — deterministic physical-printing identities keyed by release and card.
4. `Sources` — source provenance and hashes.
5. `Validation` — per-release counts, duplicate-key findings, reused-number findings, and rejected rows.

Separate products must never be merged into one release.

## Validation gates

- Enumerate all official 2025-26 archive entries before freezing scope.
- Require exact per-release row, card, parallel, and identity counts.
- Detect duplicate card keys, reused printed numbers, multi-subject cards, and duplicate fingerprints.
- Reject ambiguous rows instead of inventing identities.
- Produce a pinned read-only validation artifact and SHA-256 receipt.
- No Production writes during workbook construction or first validation.

## Production sequence

1. Read-only validation of the complete workbook.
2. Import one canary release.
3. Exact read-only Production audit.
4. Import remaining releases only after the canary passes.
5. Final audit: zero identity deficits, zero failed imports, zero public Registry grants, temporary login removed, no migration, and no deployment.

Operations-only Production PRs must not be merged.
