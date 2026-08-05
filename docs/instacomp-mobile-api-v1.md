# InstaComp Mobile API v1

The website and future Expo client use the same Checklist Registry verified pricing engine.

## Endpoints

- `POST /api/mobile/v1/instacomp/price`
- `POST /api/mobile/v1/instacomp/batch`

Both require the normal seller bearer token and delegate to the same server-enforced Registry-first routes used by the website.

## Single request

```json
{
  "inventoryItemId": "inventory UUID",
  "requestId": "client-generated trace ID",
  "aiCouncilTier": "adaptive",
  "forceIdentityRescan": false
}
```

The client sends the same trace ID in `x-instacomp-request-id` and `idempotency-key`. The server validates or replaces malformed IDs, echoes the accepted value in the response body and headers, and attaches it to each batch child request.

## Required response contract

Every response includes:

- `contract: tcos.instacomp.verified-pricing.v1`
- `apiVersion: 2026-08-04`
- `requestId`
- `durationMs`
- `Cache-Control: no-store`
- `x-instacomp-request-id`
- `x-instacomp-api-version`
- `x-instacomp-contract`
- `x-instacomp-mobile-api: v1` on Mobile routes

Successful pricing also includes the persisted Checklist Registry identity receipt and `x-instacomp-checklist-verified: true`.

Review-required cards return HTTP 409 with `CHECKLIST_IDENTITY_REQUIRED`, the accepted request ID, and any available Registry receipt. Marketplace pricing does not run.

Batch responses preserve input order, deduplicate repeated inventory IDs, process no more than 50 cards with three server workers, and return a distinct child request ID for each result. Mixed batches return HTTP 207.

## Shared client

Use `runVerifiedInstaCompPricing` or `runVerifiedInstaCompPricingBatch` from `src/lib/instacomp-verified-pricing-client.ts` with `surface: "mobile"` and the deployed site as `baseUrl`. The same helpers use the seller web endpoints when `surface` is omitted.
