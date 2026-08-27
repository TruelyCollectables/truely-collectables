# InstaComp direct Registry seller flow

All HTTP pricing requests to the seller InstaComp route are rewritten by Next.js to the Registry-verified pricing endpoint.

The verified endpoint:

1. authenticates the seller through the existing identity route;
2. resolves and persists one exact Checklist Registry identity receipt;
3. blocks unresolved cards with `CHECKLIST_IDENTITY_REQUIRED`;
4. invokes the universal marketplace pricing engine directly;
5. returns pricing plus the Registry identity receipt and verification headers.

The Pending Listings page no longer replaces `window.fetch`. Its Registry dashboard is a per-card work queue showing canonical identity, identity ID, fingerprint, review reasons, blockers, and publish readiness. Sellers can retry one card or all unresolved cards through the shared verified web/Mobile client.

Publishing remains server-gated. A seller confirmation cannot activate a draft without an identified Registry receipt, identity ID, fingerprint, verification timestamp, and locked year, manufacturer, card number, and player.
