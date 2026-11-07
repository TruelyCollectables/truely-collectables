# KINGMAKER Beckett Auto-Rematch

The Beckett corpus is imported once. Future Checklist Registry growth improves identity coverage without repeating OCR or reimporting the price guides.

When a checklist version activates as `live` or `revised`, the database trigger:

1. Finds unpromoted Beckett card rows for the same sport, year or season, manufacturer, and product.
2. Resets only rows currently marked `unmatched` or `ambiguous`.
3. Reruns exact matching against the newly active Checklist Registry version.
4. Resolves stale identity-review items and creates the correct current review item.
5. Records counts and matcher receipts in `tcos_kingmaker_beckett_rematch_runs`.

Automatic rematching does not promote prices. OCR values remain in review even after their card identity becomes exact.
