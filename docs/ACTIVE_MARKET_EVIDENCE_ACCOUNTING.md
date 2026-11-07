# Active Market Evidence Accounting

Every no-sold-comp Active Market Attack scan must reconcile every observed listing into one disposition:

- Verified pricing evidence
- Review-only scouting
- Packaging conflict
- Identity conflict
- Auction-only
- Seller's own listing

No external listing may disappear between raw search counts and the seller-facing result. The accounting receipt records query coverage, candidate dispositions, rejection reasons, a deterministic receipt hash, and whether the evidence reconciled.

Pricing is blocked when no accounting query succeeds, an external listing remains unclassified, or disposition totals do not reconcile with the external candidate universe. The seller listing remains separated from competitor pricing.
