# Market Intel Freshness — Verified Production Run

- Result: complete and delivered
- Production redeployed at: 2026-07-31T15:50:40Z
- Production domain: https://truelycollectables.com
- Report ID: 424240dd-536a-4237-a011-849ddfcb9649
- Report date: 2026-07-31
- Headline: No qualified buys cleared Beta One thresholds
- Source refresh status: complete
- Source refresh finished at: 2026-07-31T15:53:33.963Z
- Active exact-card identities: 31
- Targets attempted: 31
- Successful targets: 31
- Failed targets: 0
- Skipped identities: 0
- Marketplace candidates accepted: 140
- Listings created: 0
- Listings updated: 140
- Price changes detected: 0
- Listings rescored: 140
- Ended auctions closed: 0
- Listings marked stale: 0
- Pending alerts: 0
- Corrected email delivered: true
- Already delivered before this run: false
- Delivery skipped: false
- Delivery failed: false
- Delivery error: none

## Permanent behavior now live

- The daily report refreshes every active exact-card identity before it is generated.
- Stale listings and expired auctions are cleaned before the refresh.
- A report is not generated as fresh if no source target succeeds.
- Every saved report contains a complete or partial source-freshness receipt.
- Scheduled six-hour marketplace scans rotate through the full active identity set instead of repeatedly selecting the same oldest targets.
- Daily emails use structured HTML headings, lists, links, opportunity cards, and a visible source-freshness banner instead of displaying raw Markdown.
- Automatic and manual report generation both use the live source refresh.
- Automatic and manual report delivery both use the structured email renderer.
- A protected morning catch-up checks for a stale or missed daily report at 9:25 AM and 11:25 AM Mountain Time and rebuilds or redelivers it when necessary.

## Production authorization

A dedicated sensitive `MARKET_INTEL_INGEST_SECRET` is configured for the Production environment. Its value is not stored in this repository or this receipt.
