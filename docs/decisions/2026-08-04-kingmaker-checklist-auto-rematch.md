# Decision: Checklist activation automatically rematches unresolved Beckett rows

## Status

Accepted for implementation.

## Decision

Whenever a Checklist Registry version becomes active with `live` or `revised` status, KINGMAKER automatically reruns identity matching for unpromoted Beckett rows that are still `unmatched` or `ambiguous` for that release.

## Safety boundaries

- The trigger never promotes Beckett prices.
- OCR-derived values remain in `review` after a new exact identity match.
- Rows with existing promoted observations are excluded from automatic rematching.
- Existing unmatched or ambiguous review items are resolved and replaced with the correct current review state.
- Every automatic run is recorded in `tcos_kingmaker_beckett_rematch_runs`.
- The audit table and rematch RPC remain service-role-only.

## Result

Checklist growth improves the already-loaded Beckett corpus without re-OCRing or reimporting the guides. Newly resolvable rows become exact Registry matches automatically when the corresponding checklist version activates.
