# InstaComp Checklist Audit

Every front/back scan must produce a durable `tcos.instacomp.checklist-audit.v1` receipt showing:

- whether OCR ran, the provider, image count, and text length;
- the deterministic identity fields extracted before catalog lookup;
- whether a card number was extracted;
- whether the Checklist Registry was called and reachable;
- the exact Registry outcome, candidate count, candidate variants, parallel candidates, identity ID, reasons, and source receipts;
- whether trusted memory was used before fresh evidence;
- surface and pattern evidence used for the selected parallel;
- the final match source and pricing/learning gates.

The private coverage endpoint reports actual active/live checklist version and card-row counts. A configured URL alone is not checklist readiness.

This audit does not publish, delete images, reset cards, or authorize an unresolved identity.
