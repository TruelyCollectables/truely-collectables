# KINGMAKER + InstaComp AI Architecture

## One system, three authorities

- **KINGMAKER** is the seller operating, approval, and execution system.
- **InstaComp AI** is the shared collectible intelligence engine.
- **The central Checklist Registry** is the canonical identity authority.

There is no separate KINGMAKER AI, second comp engine, second authentication system, second inventory source of truth, or second canonical Registry.

## Seller workflow

```text
KINGMAKER Scan
  -> InstaComp local visible-evidence extraction
  -> central Checklist Registry identity lock
  -> InstaComp research and recommendation
  -> KINGMAKER Pending Listing
  -> seller review
  -> KINGMAKER authorized execution
```

## Domain-safe shell

Seller-facing routes live under the Truely Collectables application:

```text
/kingmaker
/kingmaker/scan
/kingmaker/pending
/kingmaker/inventory
/kingmaker/intelligence
/kingmaker/sourcing
/kingmaker/offers
/kingmaker/orders
/kingmaker/marketplaces
/kingmaker/payouts
/kingmaker/settings
```

The scanner, Pending Listings, inventory, orders, marketplaces, and payouts routes are thin wrappers around existing canonical seller pages. Their business logic is not copied.

## Capability registry

`src/lib/instacomp-capabilities.ts` is the typed registry of shared intelligence capabilities.

Every capability declares:

- whether exact Registry identity is required;
- preferred worker location;
- central Registry identity authority;
- InstaComp intelligence ownership;
- KINGMAKER execution ownership;
- seller mutation forbidden for InstaComp.

## Research-job contract

`src/lib/instacomp-research-contract.ts` defines one versioned job envelope carrying:

- job and request IDs;
- seller and store context;
- capability;
- subject and Registry receipt;
- requested sources;
- lifecycle status and timestamps;
- evidence;
- recommendation;
- confidence;
- blockers and failures;
- immutable audit receipt.

Every recommendation requires seller approval and is not directly executable by InstaComp.

## Evidence contract

`src/lib/instacomp-evidence-contract.ts` requires every research fact to preserve:

- source name and category;
- durable source identifier;
- retrieval and observation time;
- normalized value and optional raw hash;
- confidence and match score;
- Registry identity receipt when applicable;
- accepted, rejected, unresolved, or expired disposition;
- rejection reason;
- freshness expiration.

Marketplace titles and model statements remain evidence, not canonical truth.

## Execution boundaries

`src/lib/kingmaker-instacomp-boundaries.ts` enforces:

- Registry identity before identity-dependent trusted research;
- seller authentication;
- seller permission;
- explicit seller approval;
- zero readiness blockers;
- Registry receipt before publishing or changing listing price.

The Mac service remains intelligence-only and cannot import publishing, offer, order, or inventory execution modules.

## CI enforcement

`scripts/certify-kingmaker-instacomp-architecture.mjs` fails when:

- canonical seller pages are copied into KINGMAKER instead of wrapped;
- required shell routes disappear;
- a capability allows seller mutation;
- evidence loses provenance;
- recommendations become directly executable;
- Registry identity gates disappear;
- pricing or publishing logic is duplicated inside the KINGMAKER shell;
- the Mac service imports seller execution modules.

This architecture test complements TypeScript, lint, Production build, Registry-first scanner tests, and repository-wide audits.
