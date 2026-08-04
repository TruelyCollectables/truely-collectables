# InstaComp Verified Pricing Contract

All web and Mobile pricing clients must call the verified pricing contract. Direct calls to the legacy pricing route are unsupported for pending listings.

## Single-card endpoint

`POST /api/account/seller/inventory/instacomp-verified`

Request fields:

- `inventoryItemId` — required inventory UUID
- `aiCouncilTier` — optional, defaults to `adaptive`
- `forceIdentityRescan` — optional boolean

Execution order:

1. Authenticate the seller and confirm store access.
2. Build checklist lookup input from stored scan, OCR, card, collectible, and verified-reference metadata.
3. Resolve one exact Production Checklist Registry identity.
4. Persist the Registry identity receipt to inventory metadata.
5. Stop with HTTP 409 and `CHECKLIST_IDENTITY_REQUIRED` when identity remains unresolved.
6. Run AI-assisted marketplace discovery and exact-comp verification only after a successful Registry receipt.

Successful responses include the header `x-instacomp-checklist-verified: true`.

## Batch endpoint

`POST /api/account/seller/inventory/instacomp-verified-batch`

The batch endpoint accepts up to 50 unique inventory IDs, runs at most three server jobs concurrently, invokes only the verified single-card route, and returns per-card results. HTTP 207 represents a mixed batch containing both completed and blocked/failed cards.

Successful batch enforcement includes the header `x-instacomp-batch-checklist-enforced: true`.

## Shared TypeScript client

Use `runVerifiedInstaCompPricing` for one card and `runVerifiedInstaCompPricingBatch` for a queue. The client works in same-origin web code and in Mobile when supplied with `baseUrl` and an access token.

Registry review blockers throw `ChecklistIdentityRequiredError`, preserving the HTTP status, exact Registry reasons, and typed identity receipt for the review UI.

## Non-negotiable boundary

AI can discover and verify marketplace comps after identity resolution. AI cannot silently replace a confident Checklist Registry identity or price an unresolved pending card.
