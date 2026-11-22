# OBBFB — Direct-Vision InstaComp Intake

Version: 2026-11-21. Owner: Truely Collectables.

## New scanner

The authenticated website drop target is /api/kingmaker/obbfb-intake. The older v2 intake URL delegates to it. Both photos are archived via the Mac service's supervised photo archive; direct visual evidence is extracted with multimodal vision rather than a local Checklist Registry or Ollama.

The visual identity is used to format a title shorter than 80 characters containing only the /99 print run. A complete 09/99 copy stamp and any physical autograph/relic/inscription evidence are kept in the description. No Truely Collectables COA is claimed unless explicitly verified.

First, an exact verified TC prior sale of a different copy of the same parallel and print run can be reused. Otherwise Mac searches eBay Sold, eBay active, 130point Sold, Fanatics Collect Sold, and eBay Price Guide (1 year). SportsCardsPro is reference-only because its official API does not expose individual historical sold transactions. Never invent sold records.

Eligible sold comps must have a real URL, valid realization price, exact identity, and date within 365 days. Remove breaker dumps <= $1.25 when larger sales exist, numbered comps below 75% of max, and relic comps below $8 when larger examples exist. Dedupe, take median, then price at max(2.99, floor(median*1.25)+.99). Zero genuine comps returns 0 Comps — Seller Price Required and an empty automatic price.

New cards remain unpublished private draft in Resale Pending. Suspect active duplicates route to NEED TO MERGE without quantity changes. Seller may edit identity, price, title and description and must confirm in the direct operator form. Save & Lock sets sellerPriceOverride, manualIdentityLocked, humanVerified and manualListingTitleLocked. No auto publish.

## Key source files

- src/lib/obbfb-intake-rules.ts
- src/lib/obbfb-direct-vision.ts
- src/lib/obbfb-market-comps.ts
- src/lib/obbfb-publication-guard.ts
- src/app/api/kingmaker/obbfb-intake/route.ts
- src/app/api/kingmaker/obbfb-lock/route.ts
- src/app/kingmaker/OBBFBOperatorForm.tsx
- services/instacomp-ai/app/kingmaker_commercial_inventory.py
- scripts/run-obbfb-intake-regressions.ts
- services/instacomp-ai/tests/test_obbfb_owner_locks.py

## Live integration / known blockers

The running Mac-local 8787 service is separate from this website repository, launched from /Volumes/Fanxiang S101 2TB/Projects/InstaComp-AI/service. It has code drift and must receive a carefully backported, tested commercial inventory lock patch with a full backup and controlled service restart. Do not simply replace its complete module.

kingmaker_commercial_inventory.sqlite3 and kingmaker_accounting.sqlite3 are on the designated 1TB SSD. The active scan database instacomp_ai.sqlite3 in that runtime location is a symlink to the Fanxiang repo. Move it only under coordinated WAL backup and service restart. This build does not silently migrate that file.

The Cloudflare deployment must be built, checked and verified against an authenticated real two-photo scan and an actual marketplace sale. Unverified real-world vision and comp responses must not be called certified. Neither the deterministic tests nor the temporary SQLite tests publish items or touch live inventory.
