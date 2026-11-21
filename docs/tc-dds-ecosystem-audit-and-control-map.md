# TC + DDS Ecosystem Audit and Control Map

Audit date: 2026-11-21 (America/Denver)

## Scope

This audit covers only:

- Truely Collectables (TC) storefront and its Kingmaker/Instacomp operating system.
- Dag Danky Shoes (DDS) storefront and its marketplace inventory.
- Shared inventory, images, pricing, quantity, orders, feeds, marketplace, hosting, and monitoring boundaries.

The presidential campaign and unrelated projects are intentionally excluded.

## Current system boundary

### Truely Collectables

TC and Kingmaker are implemented in the `TruelyCollectables/truely-collectables` application.

Known operating surfaces include:

- Public storefront, shop, product, cart, checkout, account, shipping, returns, and recently-sold pages.
- Kingmaker receiving, scan, pending, resale-ready, inventory, listings, marketplaces, orders, offers, payouts, sourcing, missing-picture, intelligence, and settings.
- Seller inventory search, edit, quantity, bulk actions, select-all-loaded, duplicate detection, duplicate merge, and archive controls.
- InstaComp identity, front/back image, registry, pricing, market-check, and listing-readiness workflows.
- eBay import, sync, publish, launch-ready, duplicate cleanup, and order-sale sync workflows.
- Google Merchant feed, sitemap, Cloudflare Workers, edge-health probes, and production smoke checks.

### Dag Danky Shoes

DDS is a separate public storefront at `dagdankyshoes.com`, not a second storefront directory in the TC GitHub application.

Known public surface:

- DDS shop and product pages.
- Shoe-specific title, size, condition, image, and availability data.
- Marketplace relationships with eBay, Mercari, and Poshmark.

This means DDS cannot be considered synchronized merely because TC/Kingmaker is healthy. DDS requires its own source-of-truth and reconciliation checks.

## Data flow that must be enforced

```
Master inventory record
  -> canonical product identity
  -> correct storefront (TC or DDS)
  -> marketplace listings
  -> quantity/status reconciliation
  -> order/sale event
  -> every other channel updated
  -> audit receipt
```

## Hard controls required

1. Every item has exactly one canonical inventory record.
2. Every record is explicitly assigned to TC or DDS.
3. A product cannot publish without an identity, image, price, quantity, and ownership scope.
4. Duplicate detection runs before publish and during reconciliation.
5. Quantity changes are written to the canonical record first.
6. Marketplace quantity cannot exceed canonical quantity.
7. A sale on any channel creates a reconciliation job for every other channel.
8. Archived or zero-quantity items cannot remain purchasable.
9. Images must be checked against the canonical product, not only the title.
10. Every merge, archive, sale sync, and quantity change leaves an audit receipt.
11. TC and DDS must have separate health status, even when they share business infrastructure.
12. A failed reconciliation must be visible to the operator and must not silently overwrite newer data.

## Current observations

### TC

- Public TC storefront and shop are live.
- TC currently exposes thousands of active card records publicly.
- The application contains extensive Kingmaker and InstaComp control surfaces.
- Cloudflare, sitemap, Merchant feed, and production health checks exist.
- Duplicate cleanup exists for active eBay rows and is now linked from Kingmaker inventory.
- Inventory search/edit/quantity controls exist.
- Pending workflow select-all remains available.

### DDS

- Public DDS shop is live with shoe listings, sizes, prices, and product pages.
- DDS is not represented as a peer storefront in the TC application tree.
- The DDS-to-marketplace sync must therefore be audited separately rather than inferred from TC health.

## Audit sequence

### Phase A — Establish truth

- Export TC canonical inventory.
- Export DDS canonical inventory.
- Export eBay, Mercari, and Poshmark active listings.
- Normalize titles, SKUs, images, sizes, serials, and quantities.
- Assign every row to TC, DDS, or unresolved.

### Phase B — Find conflicts

- Duplicate listings.
- Same item in both businesses.
- Website quantity different from marketplace quantity.
- Sold item still live elsewhere.
- Zero-quantity item still purchasable.
- Wrong image attached to listing.
- Wrong shoe size or card parallel.
- Missing or stale marketplace listing.
- Products with no canonical owner.

### Phase C — Correct safely

- Merge only exact, non-serialized duplicates.
- Preserve both images and archive the duplicate row.
- Correct quantities from the canonical record.
- Mark sold/archived everywhere after a confirmed sale.
- Quarantine ambiguous records instead of guessing.
- Produce an audit receipt for every change.

### Phase D — Continuous control

- TC status strip: storefront, feed, sitemap, edge health, inventory sync.
- DDS status strip: storefront, inventory, marketplace sync, image/size integrity.
- Daily reconciliation report.
- Duplicate scan before publishing.
- Post-sale reconciliation.
- Weekly forensic audit.
- Alert when either storefront drifts from its canonical inventory.

## First implementation target

Build one operator-facing TC/DDS control center with:

- Separate TC and DDS status cards.
- Canonical inventory counts.
- Marketplace drift counts.
- Duplicate groups.
- Quantity conflicts.
- Sold-but-still-live alerts.
- Missing-image and wrong-image alerts.
- “Review,” “merge,” “archive,” and “resync” actions.
- Immutable audit receipts.

No automatic destructive correction should run until the record is classified as exact and safe.
