# Totally Collectibles OS Operator Manual

Copyright 2026 Dag Danky Holdings LLC. All rights reserved.

Authored by David Bakanas.

Software ownership: Dag Danky Holdings LLC.

Software platform: Totally Collectibles OS (TCOS).

Main TCOS website/domain: TotallyCollectibles.com.

Flagship store / Store #1: Truely Collectables.

Last updated: 2026-06-28

This is the working manual for Totally Collectibles OS (TCOS). It must stay current as features are added.

TCOS means Totally Collectibles OS. It is the multi-store software platform, admin system, order system, inventory engine, marketplace layer, and pricing/helper system. Truely Collectables is the flagship store inside TCOS, not a separate rebuild.

## Ownership And Account Separation

David Bakanas is the owner of Dag Danky Holdings LLC.

Dag Danky Holdings LLC owns and administers the Totally Collectibles OS software platform.

David Bakanas is an admin/operator of Dag Danky Holdings LLC and TCOS.

Truely Collectables LLC is the collectables storefront operating company and should be treated as Store #1 inside TCOS. It should become its own platform seller/buyer account when seller, buyer, collection, wishlist, trade, or payout accounts are built.

Dag Danky Shoes is the footwear storefront/operator for the shoe and sneaker portion of the platform. It should be treated as its own storefront seller/buyer account when footwear seller, buyer, inventory, collection, wishlist, trade, or payout accounts are built.

David Bakanas is also the admin/operator of the Truely Collectables LLC account.

Dag Danky Holdings LLC platform revenue should come from:

- platform commission/rake from third-party seller transactions
- the commission/rake is calculated from total sale amount, including item sale price plus buyer-paid shipping
- advertising revenue
- sponsorship revenue
- other platform-level service fees only after they are defined and disclosed

Truely Collectables LLC revenue and activity should stay separate from Dag Danky Holdings LLC platform revenue. Truely Collectables LLC is the storefront seller/buyer account for its own buying, selling, collecting, inventory, offers, trades, messages, payouts, and account history.

Truely Collectables LLC must have completely separate login credentials, account profile, seller settings, buyer settings, payout setup, and audit history from Dag Danky Holdings LLC platform-admin access.

Future account roles should stay separate:

- `platform_owner`: Dag Danky Holdings LLC
- `platform_admin_user`: David Bakanas and any future authorized TCOS admins
- `storefront_operator`: Truely Collectables LLC
- `storefront_seller_account`: Truely Collectables LLC selling inventory on TCOS
- `storefront_buyer_account`: Truely Collectables LLC buying/trading/collecting on TCOS when needed
- `footwear_storefront_operator`: Dag Danky Shoes
- `footwear_seller_account`: Dag Danky Shoes selling footwear inventory on TCOS
- `footwear_buyer_account`: Dag Danky Shoes buying/trading/collecting footwear on TCOS when needed
- `external_seller_account`: future third-party sellers
- `external_buyer_account`: future customers/collectors

Important rule:

Dag Danky Holdings LLC admin authority must not be mixed with Truely Collectables LLC seller/buyer activity. David may administer both, but the software should track platform-admin actions separately from seller/buyer actions so audits, payouts, disputes, chargebacks, taxes, and permissions stay clean.

## Product North Star

TCOS should be built toward the ultimate collecting experience.

The collector should feel:

- confident they know exactly what the item is
- informed about rarity, demand, condition, and market value
- protected by clear policies, secure checkout, and honest evidence
- excited when the item arrives
- proud enough to share the pickup, collection, story, or mail day with the community

Every customer-facing item page should help answer:

- What exactly is this collectable?
- Why does it matter?
- How rare is it?
- What condition is it in?
- What data supports the price?
- What similar items have sold for?
- Is there population, certification, serial-number, autograph, patch, variant, or provenance information?
- What should a collector know before buying?
- What makes this item fun to own?
- What can the collector do with it after purchase, such as add it to a collection board or brag session?

Product data should be layered:

1. TCOS local inventory data
2. seller/admin-entered facts
3. AI extraction and description support
4. catalog/reference matching
5. sales comps
6. pricing guides
7. grading/certification data when available
8. rarity/population/print-run data when available
9. community context after moderation features exist

The tone should be collector-first: excited, knowledgeable, honest, and brand-safe. Public copy should invite collectors to celebrate their items without using sexual, hateful, private, or unsafe language.

### Future: Collectable Megahub And Sneaker Expansion

TCOS should be designed to become a collectable megahub, not only a sports-card storefront.

Long-term ambition:

- become a premier destination for sneaker collectors
- support shoes, cards, memorabilia, comics, toys, TCG, autographs, graded items, sealed products, and other collectables
- help collectors research, find, request, buy, trade, show off, and track what they care about
- make AI search, collection tracking, and wish lists the best collector discovery experience possible
- turn Truely Collectables into a trusted place to understand collectables, not only transact on them

Sneaker marketplace goals:

- support sneaker brands such as Nike, Jordan, Adidas, New Balance, Puma, Reebok, Asics, Converse, Vans, and future brands
- support shoe model, colorway, SKU/style code, size, gender sizing, release date, condition, box status, authenticity status, defects, and provenance
- track deadstock, new with box, used, tried on, restored, custom, sample, player exclusive, collaboration, limited release, and graded/authenticated shoe states
- store multiple photos including box label, outsole, insole, size tag, heel, toe box, stitching, defects, and receipt/provenance when available
- support authentication workflow before high-value sneaker sales go public
- support size-specific pricing and comps because sneaker value changes heavily by size
- show comparable listings and sales only when the size/model/colorway match is close enough

AI collection and wish list goals:

- users can create a wish list for any collectable category
- users can describe what they want in natural language
- AI should translate wish-list language into structured search fields
- AI should match wish-list items against TCOS inventory, seller inventory, want ads, trades, auctions, and approved outside data sources
- AI should notify users only through consented notification channels
- users can mark items as grails, priority targets, set fillers, size targets, gift ideas, or research-only
- wish lists should support budget range, condition preference, grading preference, size, category, player, team, character, franchise, era, brand, colorway, and urgency

Set builder checklist goals:

- users can create checklists for complete sets, partial sets, team sets, player runs, character runs, release runs, parallel runs, graded runs, shoe colorway runs, or custom collector goals
- checklist templates should support year, brand, set, subset, card number, player, team, character, franchise, variant, parallel, serial number, autograph, relic/patch, grade target, condition target, and notes
- users can mark each checklist item as owned, needed, upgraded, incoming, watching, trade target, or not interested
- users can attach owned items from their collection to checklist slots
- users can add missing checklist items to wish lists or want ads
- AI should help build a checklist from natural language, uploaded lists, scans, set names, catalog sources, or manufacturer checklists when allowed
- TCOS should show checklist progress by percentage, count owned, count missing, estimated value when available, and highest-priority missing items
- set builders should be able to filter by missing cards, rookies, inserts, parallels, autographs, patches, graded targets, and price range

Checklist acquisition links:

- each missing checklist item should first search TCOS inventory
- if not in TCOS inventory, show approved outside lookup links
- outside links should include eBay sold/active search, CollX research, COMC search, Sportlots search, 130point sales search, Google source search, PriceCharting/SportsCardsPro, PSA when relevant, and other approved category sources
- outside links should preserve the structured checklist query as much as possible, including year, set, card number, player, team, grade, variant, size, colorway, or brand
- TCOS should clearly label outside links as external research or external marketplace links
- TCOS should not imply outside marketplaces are partners unless a partnership exists
- users should be able to save outside finds back to a checklist as `watching`, `found externally`, or `research note`

Megahub information goals:

- product pages should become research pages
- category pages should explain brands, sets, releases, pop reports, size markets, rarity, and recent demand
- collector intelligence should apply to all categories, not only cards
- buyer decisions should be supported by sources, comps, photos, condition proof, authenticity data, and clear risk notes
- AI should help summarize the collectable's story while showing source links and confidence

Competitive standard:

- TCOS should compete on trust, depth of information, buyer confidence, seller tools, AI discovery, and collector experience
- TCOS should not copy another marketplace's user experience blindly
- TCOS should avoid fake scarcity, fake hype, fake sold data, hidden fees, or misleading authenticity claims
- every expansion category should have its own data model, condition standards, authenticity rules, pricing logic, and dispute rules

Future data tables should store:

- collectable_categories
- sneaker_products
- sneaker_sizes
- sneaker_condition_reports
- sneaker_authentication_events
- sneaker_release_data
- sneaker_price_snapshots
- user_collections
- user_collection_items
- user_wish_lists
- user_wish_list_items
- wish_list_matches
- wish_list_notifications
- set_builder_checklists
- set_builder_checklist_items
- set_builder_templates
- set_builder_item_matches
- set_builder_external_links
- set_builder_progress_snapshots
- collectable_reference_sources
- collectable_category_attributes

Downloadable PDF copy:

```text
docs/TCOS_OPERATOR_MANUAL.pdf
```

Future mobile app manual:

- the mobile app must have its own separate operator manual and downloadable PDF
- shared TCOS rules, store policies, security requirements, checkout behavior, and account requirements must stay consistent with this main site manual
- mobile-only screens, app-store release steps, push notification behavior, device permissions, and mobile troubleshooting must live in the mobile manual instead of being mixed into the web manual

The PDF is regenerated with:

```bash
npm run manual:pdf
```

Links in this manual are clickable in both Markdown and PDF form. Use them for direct lookup, examples, API docs, and troubleshooting references.

## Current V2 UI Baseline

The public storefront has been moved away from the default scaffold look.

Current UI baseline includes:

- sticky storefront navigation with TCOS/admin entry
- production metadata for Truely Collectables
- premium dark homepage hero with clear storefront positioning
- homepage feature blocks for Collector Intelligence, secure checkout, and fulfillment control
- shop page header, search/filter panel, active inventory count, and cleaner product cards
- product detail pages styled as collector research pages
- cart page with a structured order summary, shipping selector, TOS acceptance, and secure checkout action
- consistent neutral/off-white storefront background
- `/admin` now renders as a live TCOS command center with revenue metrics, fulfillment queues, offer desk, inventory watch, eBay sync policy decisions, blocked sync reasons, store settings status, evidence health, operator alerts, and fast links

## 1. Quick Start

Daily operator path:

1. Open `/admin/login`.
2. Log in with the admin password.
3. Open `/admin/products` to manage cards.
4. Open `/admin/orders` to ship paid orders.
5. Open `/admin/offers` to handle customer offers.
6. Use product edit pages to check comps, apply suggested prices, update descriptions, and change inventory status.

Most day-to-day work starts at:

```text
/admin
```

## 2. Routes

### Public Storefront

| Route | Purpose |
| --- | --- |
| `/` | Home page |
| `/shop` | Product grid with search and sport filtering |
| `/product/[id]` | Product detail page |
| `/cart` | Customer cart |
| `/account` | Customer account home |
| `/account/login` | Customer email/password login |
| `/account/signup` | Customer email/password signup |
| `/success` | Purchase confirmation page with rotating collector sayings |
| `/terms` | Customer Terms of Service |
| `/seller-terms` | Seller Terms of Service for future auction/seller accounts |
| `/seller` | Seller home redirect to marketplace connections |
| `/seller/marketplaces` | Seller marketplace connection dashboard for Store #1 sync foundation and future seller-safe connectors |

### Admin

| Route | Purpose |
| --- | --- |
| `/admin/login` | Admin login |
| `/admin` | Admin dashboard |
| `/admin/accounts` | Customer account lookup and linked order/offer activity |
| `/admin/products` | Product list |
| `/admin/products/new` | Add product |
| `/admin/products/[id]` | Edit product and pricing tools |
| `/admin/orders` | Fulfillment center |
| `/admin/orders/[id]` | Order detail and tracking |
| `/admin/orders/[id]/packing-slip` | Printable packing slip |
| `/admin/files` | Transaction evidence files |
| `/admin/launch-readiness` | Live payment and production readiness checklist |
| `/admin/inventory/category-review` | eBay import category confidence and review queue |
| `/admin/ebay/sync-control` | Controlled eBay batch sync launcher |
| `/admin/offers` | Offer review |
| `/admin/security` | Admin login audit and lockout review |

### API

| Route | Purpose |
| --- | --- |
| `/api/admin/login` | Sets `admin_auth` cookie |
| `/api/admin/logout` | Clears admin cookie |
| `/api/admin/files/[id]/download` | Downloads transaction evidence PDF |
| `/api/account/signup` | Creates customer account through Supabase Auth |
| `/api/account/login` | Logs customer account in through Supabase Auth |
| `/api/account/orders` | Returns logged-in customer order history for the active store |
| `/api/account/dashboard/preferences` | Saves account sports/team and market watchlist preferences |
| `/api/account/collector/profile` | Loads and saves collector bio, social URLs, visibility, and message preference |
| `/api/account/collector/items` | Saves collection shelf items, wish list items, want ads, set needs, and trade targets |
| `/api/account/collector/exports` | Downloads the logged-in collector collection as CSV or full catalog JSON |
| `/api/account/collector/messages` | Creates and lists collector conversation records |
| `/api/account/collector/binding-offers` | Starts a card-required binding offer through Stripe setup checkout |
| `/api/account/seller/payout-onboarding` | Starts or checks Stripe-hosted seller payout/bank verification |
| `/api/account/seller/marketplace-connections` | Returns logged-in seller marketplace connection records for the active store |
| `/api/checkout` | Creates Stripe checkout session |
| `/api/webhook` | Main Stripe webhook handler |
| `/api/stripe/webhook` | Alternate Stripe webhook handler |
| `/api/offers/create` | Customer offer submission |
| `/api/offers/update-status` | Accept/decline offer |
| `/api/offers/counter` | Send counter offer |
| `/api/orders/update-tracking` | Save carrier/tracking |
| `/api/orders/mark-shipped` | Mark shipped and send email if configured |
| `/api/ebay/auth` | Start eBay OAuth |
| `/api/ebay/callback` | Store eBay refresh token |
| `/api/ebay/import-listings` | Import one eBay inventory page |
| `/api/ebay/full-sync` | Batch import eBay inventory |

## 3. Admin Login

Admin login uses:

```env
ADMIN_PASSWORD=
```

Successful login sets a cookie:

```text
admin_auth=<issued_timestamp>.<signature>
```

Cookie behavior:

- HTTP-only
- Secure
- Same-site lax
- Max age: 24 hours

Protected admin routes redirect to `/admin/login` if the cookie is missing.

Admin sessions are signed by `ADMIN_SESSION_SECRET` when configured. If `ADMIN_SESSION_SECRET` is missing, TCOS falls back to `ADMIN_PASSWORD` for signing. Production should use a separate strong `ADMIN_SESSION_SECRET`.

Admin login hardening:

- password verification uses fixed-length hashed comparison instead of plain string equality
- every login attempt is evaluated through `src/lib/admin-login-security.ts`
- failed and successful attempts are written to `admin_login_attempts` when the table is available
- login attempts store store ID, IP address, user agent, result, failure reason, identity risk, header evidence, and lockout timestamp when applicable
- five failed attempts from the same IP inside 15 minutes triggers a 15-minute lockout
- locked-out login attempts return HTTP `429`
- masked or blocked identity attempts return HTTP `403`
- if the audit table has not been migrated yet, login still works but audit/lockout storage is unavailable

Admin login policy:

| Setting | Value |
| --- | --- |
| Failed-attempt window | 15 minutes |
| Failed-attempt limit | 5 |
| Lockout duration | 15 minutes |

Admin security page:

```text
/admin/security
```

This page shows recent admin login attempts, successful logins, failed logins, active lockouts, unique IP count, identity risk, failure reason, lockout expiration, and user agent. If the audit table has not been migrated yet, the page shows an unavailable warning instead of crashing.

Launch readiness also checks whether `admin_login_attempts` is available. If the table is missing or unavailable, `/admin/launch-readiness` marks Admin Login Audit as blocked.

The same `/admin/security` page also shows public money-path rate-limit events from `public_endpoint_rate_limit_events`, including checkout attempts, public offer attempts, collector binding-offer setup, seller payout onboarding, blocked status, endpoint, IP address, subject key, identity risk, block reason, policy window, and header evidence summary.

Launch readiness checks whether `public_endpoint_rate_limit_events` is available. If the table is missing or unavailable, `/admin/launch-readiness` marks Public Endpoint Rate Limits as blocked.

The same `/admin/security` page also lists saved IP investigations from `security_ip_investigations`. These cases show the IP address, status, severity, updated/reviewed/resolved timestamps, and internal notes.

Launch readiness checks whether `security_ip_investigations` is available. If the table is missing or unavailable, `/admin/launch-readiness` marks Security IP Investigations as blocked.

Suspicious IP drilldown:

```text
/admin/security/ip/[ip]
```

IP addresses on `/admin/security` link to a focused IP dossier. The dossier combines admin login attempts, public money-path rate-limit events, TOS acceptance evidence, orders, offers, and transaction evidence reports tied to that server-observed IP. Use it when reviewing blocked checkout attempts, offer spam, suspicious account behavior, chargebacks, or repeat abuse.

The IP dossier includes an investigation form. Admins can mark the IP as `watch`, `review`, or `resolved`, set severity as `low`, `medium`, `high`, or `critical`, and save internal notes. Saving the form updates `last_reviewed_at`; resolving the case stores `resolved_at`.

## 4. Product And Inventory Basics

TCOS currently keeps two inventory layers in sync:

1. Legacy `products`
2. TCOS V2 `inventory_items`

The legacy `products` table still supports older screens and relations. The V2 `inventory_items` table is the newer inventory authority for status, price, and quantity.

The sync layer is:

```text
src/modules/inventory/engine.ts
```

Do not bypass the engine for normal admin inventory changes.

Inventory V2 bridge screen:

```text
/admin/inventory
```

Use this screen to verify that every legacy storefront product has a matching TCOS V2 `inventory_items` record. The page shows total legacy products, V2 bridged items, missing inventory rows, mismatch counts, active items, sold-out items, and eBay-linked items.

The `Backfill V2 Inventory` button runs an idempotent backfill. It can be run more than once. It scans Store #1 products, creates missing `inventory_items`, updates existing inventory rows by legacy product ID or SKU, mirrors quantity/price/title/description/status, and adds product images into `inventory_images` when they are not already present.

Reconciliation labels:

| Label | Meaning |
| --- | --- |
| `OK` | Legacy product and V2 inventory row are aligned |
| `MISSING INVENTORY ITEM` | Product exists but no V2 inventory row exists yet |
| `SKU LINK ONLY` | V2 row matched by SKU but still needs the legacy product bridge filled |
| `QUANTITY MISMATCH` | Legacy quantity and V2 quantity differ |
| `PRICE MISMATCH` | Legacy price and V2 price differ |
| `SOLD OUT` | Product quantity is zero; not a failure by itself |

eBay import safety:

The eBay import path is store-scoped. It first updates by Store #1 eBay listing ID, then by Store #1 SKU, then inserts a new product if no store-scoped match exists. It does not perform a global SKU upsert across all stores.

## 4A. Multi-Store Platform Foundation

TCOS is being converted from a single-store Truely Collectables app into a multi-store Totally Collectibles OS platform without breaking Store #1.

Current Store #1:

```text
Truely Collectables
Truely Collectables LLC
store_id: 00000000-0000-4000-8000-000000000001
```

Foundation migration:

```text
supabase/migrations/20260628110000_create_tcos_stores.sql
supabase/migrations/20260628113000_create_store_settings.sql
```

The migration:

1. Creates `stores`.
2. Inserts Store #1 = Truely Collectables.
3. Adds defaulted `store_id` columns to current core tables.
4. Backfills existing rows to Store #1.
5. Adds store indexes for future filtering.

Tables prepared with `store_id`:

- `products`
- `inventory_items`
- `orders`
- `order_items`
- `offers`
- `ebay_tokens`
- `sales_comp_snapshots`
- `tos_acceptance_events`
- `transaction_evidence_reports`
- `account_collector_profiles`
- `account_conversations`
- `account_conversation_messages`
- `account_binding_offers`
- `account_collection_export_jobs`

Safety rule:

Current Store #1 constants live in:

```text
src/lib/stores.ts
```

Current active store context is resolved through `src/lib/stores.ts`. Store #1 is still the only active store, but app code now calls active-store helpers instead of importing the Store #1 ID across the app.

Current write paths pass the active store ID when creating products, inventory items, orders, order items, offers, eBay tokens, sales comp snapshots, TOS acceptance events, and transaction evidence reports. Current inventory, eBay token, sales comp, fulfillment, offer, evidence, admin, and success-page read/update paths are also scoped to the active store. The database default still points new rows to Store #1 as a safety net.

The inventory repository and inventory engine now carry store context internally. Future multi-store work should replace the current Store #1 resolver with request/account/domain-selected store context.

Store operational settings live in:

```text
src/lib/store-settings.ts
```

The `store_settings` table stores per-store support, sales, offer, evidence, order email, Stripe mode, eBay environment, eBay account label, and seller commission settings. If the table is missing or empty, TCOS falls back to current environment variables and Store #1 defaults so production behavior does not break.

`/admin/launch-readiness` shows the active store settings and whether they came from the database or fallback defaults.

## 5. Inventory Status Values

Allowed status values:

| Status | Meaning | Checkout allowed? |
| --- | --- | --- |
| `draft` | Not ready to sell | No |
| `active` | Ready to sell | Yes, if quantity is enough |
| `reserved` | Held back | No |
| `sold` | Sold out | No |
| `archived` | Removed from active workflow | No |

Checkout requires:

- status is `active`
- quantity is greater than or equal to cart quantity
- price is greater than zero

## 6. Add A Product

Open:

```text
/admin/products/new
```

Fields:

- Title
- Player
- Sport
- Price
- Quantity
- Image URL
- Description

Description can be left blank. If blank, TCOS generates a description from product data.

When saved, TCOS:

1. Creates a row in `products`.
2. Creates a row in `inventory_items`.
3. Creates an `inventory_images` primary image row if image URL exists.
4. Redirects to `/admin/products`.

## 7. Edit A Product

Open:

```text
/admin/products
```

Click `Edit`.

Edit page:

```text
/admin/products/[id]
```

Fields editable:

- Title
- Player
- Sport
- Price
- Quantity
- Status
- Image URL
- Description

Click `Save Product`.

Save behavior:

1. Updates legacy `products`.
2. Ensures V2 `inventory_items` exists.
3. Updates V2 title/description/category/status/quantity/price.
4. If image URL changed, adds a new primary `inventory_images` row.
5. Publishes an in-memory inventory event.

## 8. Quick Status Buttons

On `/admin/products/[id]`:

- `Set Active`
- `Reserve`
- `Mark Sold`
- `Archive`

`Mark Sold` sets quantity to `0`.

Status changes update through `inventoryEngine.setStatus`.

## 9. Product Description Tools

On `/admin/products/[id]`, the Description panel has:

- `Auto-Fill Description`
- `AI Write Description`

### Auto-Fill Description

Uses only local TCOS product data.

Generated from:

- title
- player
- sport
- price
- quantity
- status
- SKU
- eBay listing ID

This is deterministic and does not call outside APIs.

### AI Write Description

Uses [OpenAI API docs](https://platform.openai.com/docs/api-reference) if configured:

```env
OPENAI_API_KEY=
OPENAI_DESCRIPTION_MODEL=
```

Default model:

```text
gpt-5.5
```

If OpenAI is not configured or the request fails, TCOS falls back to local auto-fill.

The AI prompt forbids inventing:

- year
- set
- grade
- condition
- autograph
- patch
- serial number
- rookie status
- scarcity

### Product Detail Collector Intelligence

Product pages currently show a Collector Intelligence panel on:

```text
/product/[id]
```

Implementation files:

```text
src/app/product/[id]/page.tsx
src/lib/collector-intelligence.ts
```

Current behavior:

- lays out `/product/[id]` as a collector research page with image, status badge, price, purchase actions, description, and a collector snapshot
- the collector snapshot shows category, player/subject, availability, status, SKU, and eBay linkage when available
- shows an honest trend badge
- defaults to `Not Enough Verified Data`
- creates market research links for eBay sold search and 130point
- creates acquisition/research links for TCOS search, eBay active search, COMC, Sportlots, CollX, PriceCharting, SportsCardsPro, PSA Auction Prices, and Google marketplace search
- creates news/source links for Google News and official-source searches
- creates an X search link for the player, item, team, character, or franchise query
- shows a `Complete The Set Or Run` helper with TCOS, eBay, COMC, Sportlots, CollX, manufacturer-checklist, and 130point research links
- shows an `Exact Match Signals` panel using deterministic title extraction
- detects title-level serial numbering, card number, parallel/finish words, autograph, relic/patch, rookie, grading company, and grade signals when present
- marks title-level variant/parallel evidence as needing checklist/source confirmation before TCOS claims an exact rare variation
- detects PSA, SGC, CGC, Beckett, or BGS names in the title when present
- detects grade-like title text when present
- detects cert-number-like title text when present
- links to official grading lookup pages
- gives a watch list of things collectors should check before treating the item as hot or rare

TCOS does not currently store live trend snapshots or verified grading population counts for storefront display. Until those sources are saved and verified, the public trend state remains `Not Enough Verified Data`.

## 10. Sales Comps

Sales comps live on:

```text
/admin/products/[id]
```

Click:

```text
Check eBay Sold Comps
```

The page reloads with:

```text
?comps=true
```

TCOS tries these sources:

1. [eBay Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace_insights/overview.html)
2. [eBay completed-items fallback](https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan+1991+Fleer&_sacat=0&LH_Sold=1&LH_Complete=1)
3. [Google Programmable Search JSON API](https://developers.google.com/custom-search/v1/overview), if configured
4. [PriceCharting](https://www.pricecharting.com/) / [SportsCardsPro](https://www.sportscardspro.com/) API, if configured

TCOS also gives research links for:

- [CollX](https://www.collx.app/)
- [130point sales search](https://130point.com/sales/)
- [Google sold search example](https://www.google.com/search?q=Michael+Jordan+1991+Fleer+sold+card)
- [PriceCharting example search](https://www.pricecharting.com/search-products?q=Michael+Jordan+1991+Fleer&type=prices)
- [SportsCardsPro](https://www.sportscardspro.com/)
- [PSA Auction Prices](https://www.psacard.com/auctionprices)
- [Card Ladder](https://app.cardladder.com/)
- [ALT](https://app.alt.xyz/)
- [COMC](https://www.comc.com/)
- [eBay sold search example](https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan+1991+Fleer&_sacat=0&LH_Sold=1&LH_Complete=1)

### Lookup Examples

Use the product title, player, year, set, card number, grade, and autograph/patch terms when known.

Example searches:

- [eBay sold: Michael Jordan 1991 Fleer](https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan+1991+Fleer&_sacat=0&LH_Sold=1&LH_Complete=1)
- [Google sold-card search: Michael Jordan 1991 Fleer](https://www.google.com/search?q=Michael+Jordan+1991+Fleer+sold+card)
- [PriceCharting: Michael Jordan 1991 Fleer](https://www.pricecharting.com/search-products?q=Michael+Jordan+1991+Fleer&type=prices)
- [PSA Auction Prices](https://www.psacard.com/auctionprices)
- [130point sales search](https://130point.com/sales/)

When checking comps, ignore listings that are not the same card or same grade. A raw card, PSA 10, BGS 9.5, autographed card, patch card, serial-numbered parallel, and base card are different markets.

## 11. Suggested Price

Suggested price uses a CollX-style method:

1. Average of up to 10 recent sold comps from the last six months.
2. If unavailable, use the last known sold comp.
3. If unavailable, use median of available comps.
4. If no comps exist, no suggested price is shown.

Displayed values:

- Suggested
- Count
- Median
- Average
- Range
- Recent comps used
- Source status

## 12. Apply Suggested Price

Click:

```text
Apply Suggested Price
```

TCOS does not trust stale browser data. It recalculates comps server-side, saves a new snapshot, then updates the product price.

Flow:

1. Load current product from `inventoryEngine`.
2. Run `getSalesComps`.
3. Save a `sales_comp_snapshots` row if table exists.
4. If suggested price exists, update product through `inventoryEngine.updateProduct`.
5. Redirect back to product edit page with comps loaded.

## 13. Comps History

Comps history shows on product edit pages.

Table:

```text
sales_comp_snapshots
```

Migration:

```text
supabase/migrations/20260627160000_create_sales_comp_snapshots.sql
```

If this table is missing, the page still works but history will show a Supabase error. Apply the migration to enable saving.

## 14. eBay Sync

### Connect eBay

Start OAuth:

```text
/api/ebay/auth
```

Callback stores refresh token into:

```text
ebay_tokens
```

Reference links:

- [eBay Developers Program](https://developer.ebay.com/develop)
- [eBay Sell Inventory API](https://developer.ebay.com/api-docs/sell/inventory/overview.html)
- [eBay Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace_insights/overview.html)

### Import Listings

Single page:

```text
/api/ebay/import-listings
```

Batch sync:

```text
/api/ebay/full-sync
```

Controlled admin launcher:

```text
/admin/ebay/sync-control
```

Import behavior:

1. Reads latest eBay refresh token.
2. Gets eBay access token.
3. Pulls eBay inventory items.
4. Fetches offer data per SKU.
5. If listing is active, updates `products` and `inventory_items`.
6. Maps the eBay title/aspects into a TCOS category.
7. Saves useful eBay aspects as generated inventory attributes.
8. If listing is not active, marks local quantity zero.

It does not delete eBay inventory.

Current eBay category mapper output:

- `sports_cards`
- `trading_cards`
- `shoes`
- `comics`
- `memorabilia`
- `toys`
- `sealed_wax`
- `autographs`
- `coins`
- `other_collectable`

The mapper stores category confidence in generated attributes. Low-confidence imports remain in inventory but receive `tcos_review_required = true` so admin review can identify listings that need better categorization instead of silently guessing wrong.

Admin review:

```text
/admin/inventory/category-review
```

This page shows mapped eBay imports, TCOS category confidence, review-required flags, mapping evidence, and sample eBay aspects. Review-required, low-confidence, and `other_collectable` rows appear first and link back to the product edit screen.

Safe sync workflow:

1. Open `/admin/ebay/sync-control`.
2. Run a small batch, usually 10 or 25 listings.
3. Review imported categories on `/admin/inventory/category-review`.
4. Continue with the next offset if results look clean.
5. Use larger batch sizes only after the category mapper is behaving well.

The full-sync API accepts optional `limit` and `maxBatches` query parameters. Allowed batch sizes are 10, 25, 50, and 100. `maxBatches` is capped at 25.

Current sync implementation:

```text
src/lib/ebay-sync.ts
src/lib/ebay-category-mapper.ts
```

Both single-page import and full sync use this shared server-side importer. Full sync calls the importer directly instead of calling TCOS through its own protected HTTP route, so it does not depend on an admin browser cookie or `NEXT_PUBLIC_SITE_URL` to keep running. This keeps Truely Collectables eBay sync more reliable when the toggle is enabled.

### eBay Sync Policy Decisions

Open:

```text
/admin/ebay/sync-control
```

The controlled sync page now shows public inventory totals, the last batch result, current-run policy decisions, and blocked policy summaries.

Inventory stats shown:

- public products
- in-stock products
- sold-out products
- eBay-linked products
- missing SKU products

Decision labels:

| Decision | Meaning |
| --- | --- |
| `ALLOWED` | TCOS allowed the sync action |
| `NEEDS REVIEW` | TCOS imported the listing but flagged it for admin category/title review |
| `BLOCKED BY TCOS POLICY` | TCOS refused the local import/update because required listing evidence was unsafe or incomplete |

Current blocked reasons:

- missing SKU
- missing eBay listing ID
- invalid listing price
- invalid listing quantity

Current review reasons:

- missing product title
- category review required
- low category confidence

Important rule:

Blocked sync decisions only protect TCOS local inventory. They do not delete, revise, or end eBay-side inventory.

Decision events are stored in:

```text
ebay_sync_decision_events
```

Summary views:

```text
tcos_ebay_snapshot_import_decision_summary
tcos_ebay_missing_sync_decision_summary
tcos_public_inventory_stats
```

### eBay Health

Open:

```text
/admin/ebay
```

This page is the local eBay reconciliation board. It does not call eBay on page load. It reads TCOS product and inventory data to show whether Store #1 inventory looks ready for eBay sync.

The page shows:

- total products
- eBay-linked products
- healthy linked products
- products needing attention
- missing SKU count
- never-synced count
- stale-sync count
- sold-out count
- latest eBay import timestamp

Health labels:

| Label | Meaning |
| --- | --- |
| `OK` | Linked product has no local sync warning |
| `MISSING SKU` | Product cannot safely sync to eBay inventory without a SKU |
| `NOT LINKED` | Product is local-only and has no eBay listing ID |
| `NEVER SYNCED` | Product has an eBay listing ID but no `last_seen_at` import timestamp |
| `STALE SYNC` | Product has not been seen by eBay import in the configured stale window |
| `SOLD OUT` | Local TCOS quantity is zero |

Current stale window:

```text
12 hours
```

Buttons on the page:

| Button | Purpose |
| --- | --- |
| `Test Route` | Confirms the eBay test route responds |
| `Import Batch` | Runs one import page from eBay |
| `Full Sync` | Runs the batch eBay import loop |
| `Reconnect` | Starts eBay OAuth again |

Rule:

Use `/admin/ebay` before and after large imports. Missing SKU and stale sync warnings should be reviewed before assuming local inventory and eBay inventory agree.

### eBay Sync Toggle

Open:

```text
/admin/settings
```

The `Enable eBay Sync` toggle controls whether the active store can use eBay integration.

When eBay sync is enabled:

- `/api/ebay/import-listings` can import an eBay inventory page
- `/api/ebay/full-sync` can run the batch import loop
- `/api/ebay/auth` can reconnect the store's eBay OAuth token
- completed sales can push quantity changes back to eBay

When eBay sync is disabled:

- import is blocked
- full sync is blocked
- reconnect/OAuth is blocked
- post-sale eBay quantity updates are skipped
- `/admin/ebay` shows a disabled warning

Storage:

```text
store_settings.metadata.ebay_sync_enabled
```

Default behavior:

```text
enabled
```

This keeps Store #1 working unless an admin intentionally turns eBay sync off. For TCOS/future stores, turn this off when eBay sync should not help an outside seller or competitor.

## 15. Checkout

Checkout route:

```text
/api/checkout
```

Customers must accept the Terms of Service before checkout can start.

Current Terms of Service:

```text
/terms
```

Current TOS version:

```text
2026-06-28
```

Checkout validates:

- cart is not empty
- duplicate cart lines are combined by product before quantity checks
- product IDs and quantities must be positive whole numbers
- shipping method is valid
- shipping is currently limited to United States addresses
- Terms of Service was accepted
- cart metadata fits inside Stripe metadata limits
- each product exists
- each product is `active`
- each product has enough quantity
- each product has a price greater than zero

Then it creates a Stripe checkout session.

Stripe checkout is configured with `shipping_address_collection.allowed_countries = ["US"]` for cart checkout, accepted offer checkout, and counter-offer checkout. Truely Collectables does not currently accept shipments outside the United States. Stripe webhooks also verify the collected shipping country before marking an order ready to ship; missing or non-US shipping evidence is stored as `paid_shipping_review` / `shipping_review`.

Successful cart checkout sends the buyer to:

```text
/success?type=cart&session_id={CHECKOUT_SESSION_ID}
```

Stripe metadata includes:

- compact cart item/quantity metadata
- shipping method
- shipping name
- shipping amount
- subtotal
- item count
- TOS accepted flag
- TOS version
- TOS accepted timestamp

Reference:

- [Stripe Checkout docs](https://docs.stripe.com/payments/checkout)

## 16. Stripe Webhooks

Main webhook:

```text
/api/webhook
```

Alternate webhook:

```text
/api/stripe/webhook
```

On `checkout.session.completed`:

1. Verify Stripe signature.
2. Create or update order.
3. Insert order items if not already inserted.
4. Decrement inventory through `inventoryEngine`.
5. Sync eBay quantity after sale.
6. If accepted offer, mark offer paid.
7. Create or update transaction evidence report.
8. Email evidence PDF if evidence email is configured.

Accepted-offer sessions use `product_id` metadata if cart metadata is missing.

Safety rule:

Webhook cart metadata is normalized the same way checkout cart input is normalized. Duplicate product lines are combined before availability checks. Current cart checkout stores compact cart metadata in Stripe so large cart JSON cannot break checkout; webhooks still accept older JSON cart metadata for existing sessions.

Webhook order fulfillment status is also shipping-policy aware. If Stripe does not provide a US shipping country, TCOS still records the paid order and transaction evidence, but the order is held as `paid_shipping_review` / `shipping_review` instead of being released as `ready_to_ship`. Review-held orders appear in the admin Fulfillment Center under the Needs Review tab and cannot be marked shipped until the review status is resolved.

Inventory decrements run through the Supabase RPC `tcos_decrement_inventory_after_sale`, which locks the product row, refuses insufficient quantity, updates `products.quantity`, mirrors the result into `inventory_items`, and returns the before/after quantity. If inventory disappears between checkout creation and Stripe webhook completion, TCOS marks the paid order as `paid_inventory_review` / `inventory_review` instead of silently overselling the item.

Order webhooks store TOS/IP acceptance fields and create a transaction evidence report. The evidence report is intended for chargeback defense, fraud review, and legal dispute support.

Offer and counter-offer Stripe success URLs send buyers to:

```text
/success?type=offer&session_id={CHECKOUT_SESSION_ID}
/success?type=counter&session_id={CHECKOUT_SESSION_ID}
```

The confirmation page uses the Stripe checkout session ID server-side to read checkout metadata, find the purchased product, and personalize the customer experience. When product data is available, it shows the purchased item image/title and themes the page with inferred team, character, franchise, or collectable colors. If product data is unavailable, it falls back to the Truely Collectables black/gold theme.

The confirmation page rotates short collector-focused sayings such as `Welcome to the family.` so the purchase feels like a meaningful addition to the customer's collection instead of a plain receipt page.

Reference:

- [Stripe webhooks docs](https://docs.stripe.com/webhooks)

### Live Payment Readiness

Open:

```text
/admin/launch-readiness
```

This page is server-rendered for admins only. It checks production configuration without exposing secret values.

It reports:

- public site URL
- Supabase configuration
- admin password/session secret configuration
- Stripe live/test/mixed key mode
- Stripe webhook secret
- IP intelligence/VPN blocking configuration
- transaction evidence email configuration
- eBay production sync configuration
- AI product helper configuration
- platform/storefront account separation status

Live buyer payments should stay closed until:

1. `NEXT_PUBLIC_SITE_URL` is the final HTTPS production domain.
2. Supabase production variables are set.
3. `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are set.
4. `STRIPE_SECRET_KEY` is a live key.
5. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is a matching live key.
6. `STRIPE_WEBHOOK_SECRET` is the live webhook signing secret for `/api/webhook`.
7. `IP_INTELLIGENCE_REQUIRED=true` and the IP intelligence provider is configured.
8. A real low-dollar checkout succeeds.
9. The order appears in admin.
10. The transaction evidence PDF is created.
11. eBay inventory quantity sync is confirmed.
12. The live test transaction is refunded in Stripe.

Platform/storefront account separation remains a readiness warning until real account roles exist. Before seller accounts, footwear operations, or third-party sellers go live, TCOS must enforce separate logins, roles, audit trails, payout profiles, and seller/buyer records for Dag Danky Holdings LLC, Truely Collectables LLC, Dag Danky Shoes, and outside sellers/customers.

## 17. Orders And Fulfillment

Open:

```text
/admin/orders
```

Tabs:

- Ready to Ship
- Shipped
- All Orders

Order detail:

```text
/admin/orders/[id]
```

Order detail shows:

- payment status
- fulfillment status
- customer name/email
- shipping address
- item list
- totals
- carrier/tracking
- packing slip link
- TOS/IP chargeback evidence
- evidence packet download if created

## 18. Transaction Evidence Files

Open:

```text
/admin/files
```

Every completed Stripe transaction should create one evidence packet in:

```text
transaction_evidence_reports
```

Evidence packets include:

- order ID
- order creation timestamp
- customer name and email
- shipping address
- carrier and tracking when saved
- shipped timestamp when marked shipped
- item list
- quantities and prices
- subtotal
- shipping paid
- total paid
- Stripe checkout session ID
- Stripe payment intent ID when available
- Stripe webhook event ID
- Stripe payment status
- accepted TOS version
- TOS accepted timestamp
- TOS acceptance audit event ID
- server-observed IP address
- user agent
- IP risk status
- IP block reason if applicable
- raw Stripe metadata saved with the transaction
- report generation timestamp

Admin actions:

- download PDF packet
- open related order
- download packet directly from the order detail page

Email behavior:

- if `RESEND_API_KEY` and `TRANSACTION_EVIDENCE_EMAIL` are set, TCOS emails the evidence PDF after the transaction report is created
- if email is not configured, the report is still saved in Admin Files
- if email fails, the error is saved on the report

Refresh behavior:

- saving tracking refreshes the saved evidence packet
- marking shipped refreshes the saved evidence packet
- the original transaction email is not resent during tracking/shipment refreshes
- the Admin Files PDF download uses the latest saved packet text

Evidence files:

```text
src/lib/evidence-pdf.ts
src/lib/transaction-evidence.ts
src/app/admin/files/page.tsx
src/app/api/admin/files/[id]/download/route.ts
```

## 19. Tracking And Shipment

Tracking update API:

```text
/api/orders/update-tracking
```

Required:

- order ID
- carrier
- tracking number

Mark shipped API:

```text
/api/orders/mark-shipped
```

Requirements:

- order exists
- carrier exists
- tracking number exists

When marked shipped:

- `fulfillment_status` becomes `shipped`
- `shipped_at` is set
- the transaction evidence packet refreshes with shipment details if one exists
- email is sent if `RESEND_API_KEY` and customer email exist

Supported tracking links:

- USPS
- UPS
- FedEx

## 20. Packing Slips

Open:

```text
/admin/orders/[id]/packing-slip
```

Use this when packing shipments.

## 21. Offers

Product pages include offer submission.

Customers must accept the Terms of Service before submitting an offer.

Offer creation route:

```text
/api/offers/create
```

Admin page:

```text
/admin/offers
```

Admin actions:

- accept
- decline
- counter

Accept/counter creates a Stripe checkout link.

Offer checkout payment decrements inventory through TCOS V2.

Accepted and counter offers must pass `inventoryEngine.requireAvailableCartItems()` before TCOS creates the Stripe checkout session. That means the product must exist, be active, have enough quantity, and have a positive checkout price.

Accepted and counter offer Stripe sessions include Store #1 metadata, cart metadata, subtotal, item count, and zero-dollar offer-checkout shipping metadata so the webhook can create a normal order record.

Accepted and counter offer Stripe sessions carry the TOS acceptance metadata from the original customer offer when available.

Accepted and counter offer Stripe sessions are also limited to United States shipping addresses.

## 22. Seller Accounts And Auctions

Seller accounts and auctions are future-build features. Do not create placeholder seller tables or fake seller account workflows before the real account model is designed.

Account signup direction:

- TCOS accounts should use email and password as the baseline login method.
- Buyer/customer accounts, seller/store accounts, and platform-admin accounts must stay separate.
- Platform admin access for Dag Danky Holdings LLC must not be mixed with Truely Collectables LLC seller/buyer activity.
- Future seller accounts must have their own profile, verification status, payout-provider IDs, TOS acceptance, audit trail, and permissions.
- Future buyer accounts must have their own profile, order history, TOS acceptance, saved addresses, collection, wishlist, want ads, and communication preferences.

Current account foundation:

```text
/account
/account/login
/account/signup
/api/account/login
/api/account/signup
/api/account/orders
/api/account/dashboard/preferences
/api/account/collector/profile
/api/account/collector/items
/api/account/collector/exports
/api/account/collector/messages
/api/account/collector/binding-offers
```

Current behavior:

- customer accounts use Supabase Auth email/password
- signup requires buyer Terms of Service acceptance
- signup requires Stripe card and billing address verification unless `ACCOUNT_CARD_VERIFICATION_REQUIRED=false`
- password must be at least 10 characters
- signup creates or updates `account_profiles` with `payment_verification_required` until Stripe setup verification completes
- signup assigns a Store #1 buyer membership in `account_store_memberships`; pending accounts use `payment_verification_required`
- pending card-verification accounts cannot log in or use authenticated account APIs as active customers
- signup/login writes `account_auth_events` when the migration exists
- signup may proceed through Stripe card and US billing address verification even when IP intelligence marks the request as VPN, proxy, Tor, relay, hosting, or anonymous; login and money-path activity remain subject to identity controls
- signup/login checks recent failed attempts by IP and email before calling Supabase Auth
- six failed signup or login attempts inside 15 minutes triggers a 15-minute account auth lockout
- account auth failures store `failure_reason` and `lockout_until` when the lockout migration exists
- logged-in checkout and offer flows attach the account ID to Stripe metadata
- completed Stripe webhooks save `orders.account_id` when account metadata is present
- customer-created offers save `offers.account_id` when the customer is logged in
- `/account` shows recent linked orders for the logged-in customer
- `/account` lets customers save a collector handle, bio, collecting focus, location label, social URLs, visibility, and message preference
- `/account` lets customers save owned collection items with category, condition, grade, estimated value, and notes
- `/account` lets customers save wish list items, 30-day want ads, set needs, and trade targets
- `/account` lets customers download their collection as CSV or a full catalog JSON backup
- `/account` lets customers save favorite teams/sports and market watchlist items
- sports dashboard preferences are stored locally first; live news, scores, schedules, and odds require approved data providers later
- market watchlist preferences support stocks, ETFs, indexes, crypto, NFTs, commodities, collectable indexes, and other assets
- `/admin/accounts` shows customer accounts, linked order counts, offer counts, TOS status, and linked revenue
- `/admin/orders` and `/admin/orders/[id]` show whether an order is linked to a TCOS account or was a guest checkout
- `/admin/offers` shows whether an offer is linked to a TCOS account or was a guest offer
- guest checkout still works and leaves `account_id` empty
- account sessions are browser-local and separate from admin login cookies
- admin login still uses `/admin/login` and `admin_auth`

Anti-fraud signup requirement:

- buyer/customer account creation requires a valid payment card and billing/address evidence through Stripe unless disabled by environment override
- the card is saved through a Stripe setup flow before the account becomes fully active
- TCOS activates the buyer account only when Stripe returns a card payment method with complete United States billing address evidence
- TCOS must not store raw card numbers, CVV, or payment credentials
- failed or canceled verification prevents account activation and login
- this requirement is intended to reduce scam accounts, chargeback risk, fake offers, and abusive collector/social activity

Migration:

```text
supabase/migrations/20260628190000_create_tcos_accounts.sql
supabase/migrations/20260628193000_link_accounts_to_orders_offers.sql
supabase/migrations/20260628201500_add_account_auth_lockouts.sql
supabase/migrations/20260628213000_create_sports_dashboard_tables.sql
supabase/migrations/20260628220000_create_collector_dashboard_tables.sql
supabase/migrations/20260628223000_create_collector_profiles_messaging_exports.sql
supabase/migrations/20260630100000_add_account_card_verification.sql
supabase/migrations/20260701074500_add_account_billing_address_evidence.sql
```

### Current: Collection Shelf, Wish List, And Want Ads

The collector dashboard now has the foundation for owned collections and hunting targets.

Collection Shelf supports:

- title
- category
- item type
- condition
- grade company
- grade value
- estimated value
- ownership status
- privacy/visibility
- favorite flag
- notes

Wish List and Want Ads support:

- wish list items
- 30-day want ads
- set needs
- trade targets
- category and item type
- player/character, team/franchise, brand, set, year, card number, and variant fields
- desired condition and grade
- budget range
- priority levels including grail
- status tracking
- future match records

Current behavior:

- collector records are account-scoped and store-scoped
- removing a collection item soft-archives it
- removing a wish list item cancels it
- want ads default to a 30-day expiration
- matching, AI identification, image uploads, alerts, and outside marketplace links are future layers on this foundation

Foundation tables:

```text
account_collection_items
account_wish_list_items
account_wish_list_matches
```

### Current: Collector Bio, Social, Messaging, Binding Offers, And Backups

Collector profiles support:

- collector handle
- bio
- collecting focus
- location label
- website URL
- social marketplace URLs for Instagram, Facebook, X, TikTok, YouTube, Whatnot, and eBay
- profile visibility
- message opt-in flag

Collector social supports:

- discovering public/community collector profiles
- following collectors
- sending friend requests
- accepting incoming friend requests
- showing a following/friends brag feed on the account dashboard
- posting a purchase brag directly from order history
- one-click default brag posting with an optional customize path
- brag visibility of private, friends, followers, community, or public
- generated share links under `/brag/[slug]`
- brag-link click tracking through `account_brag_post_clicks`
- source-tagged share actions for feed links, X, Facebook, and copied links
- weekly brag performance report foundation through `/api/admin/brag-weekly-report`

Brag post share links:

- redirect to `/shop?brag=[slug]`
- preserve `src` so traffic can be attributed to feed, X, Facebook, copied links, direct links, or future channels
- increment `account_brag_posts.click_count`
- save click audit data with source, referrer, user agent, observed IP, and timestamp
- display the TCOS/TotallyCollectibles.com link in the brag feed so shared posts can bring customers back to the marketplace

Weekly brag stats:

- configured by `BRAG_REPORT_EMAIL`
- uses `RESEND_API_KEY` when available
- falls back to saving the weekly report row if email is not configured or email fails
- stores report history in `account_brag_weekly_reports`
- includes tracked traffic by source so weekly email can show which social/link channel brought visitors back
- should be scheduled once per week by the deployment scheduler or admin automation

Collection exports:

- `/api/account/collector/exports?format=csv` downloads a spreadsheet-friendly collection backup
- `/api/account/collector/exports?format=catalog_json` downloads profile, collection items, wish list items, pricing fields, descriptions/notes, image URLs, and a media manifest
- each export writes an `account_collection_export_jobs` audit row when the migration is available

Collection imports:

- `/api/account/collector/imports` imports CSV rows into the logged-in collector's private collection shelf
- the account dashboard supports source-labeled CSV uploads for eBay, COMC, CollX, Sportlots, Whatnot, Shopify, generic CSV, and other outlets
- CSV import accepts common headers such as title, category, condition, grader, grade, certification number, image URL, listing URL, price/value, price paid/cost, source ID, SKU, and notes
- imports write only to `account_collection_items`
- imports do not create storefront products, sellable TCOS inventory, eBay listings, orders, offers, checkout rows, or Stripe activity
- duplicate checks use source marketplace plus source item ID when available, then title/category/certification fallback matching
- `account_collection_import_jobs` stores row, import, skip, and error counts when the migration is available

Messaging foundation:

- `account_conversations` stores account-to-account collector threads
- `account_conversation_messages` stores regular messages, binding-offer messages, and system messages
- the account page does not yet expose the full inbox UI; the API and schema foundation are in place

Binding offer rule:

- a binding offer starts in `payment_required`
- the buyer must accept buyer TOS
- masked identity checks still apply
- Stripe Checkout runs in setup mode before the offer is submitted
- after Stripe confirms the payment method, the webhook updates the offer to `submitted`
- the later seller-acceptance slice must charge the saved payment method, mark the offer paid or failed, and create/lock the order

Foundation tables:

```text
account_collector_profiles
account_social_connections
account_brag_posts
account_brag_post_clicks
account_brag_weekly_reports
account_conversations
account_conversation_messages
account_binding_offers
account_collection_export_jobs
```

### One Or Two Click Inventory Imports From Other Sales Outlets

Collectors and seller accounts should eventually import inventory from other sales outlets with as few steps as possible.

The first collector CSV import path is implemented for private collection shelves. Future connector work should extend this foundation to official APIs, OAuth flows, provider exports, and seller inventory import jobs.

Goal:

- connect or upload from an outside sales outlet
- preview detected items
- import into TCOS inventory or the collector's private collection
- preserve source IDs, source marketplace, listing URLs, images, descriptions, prices, condition, quantity, and category evidence
- map items through the same Universal Inventory Engine category and attribute system
- prevent duplicate imports by source listing ID, SKU, and normalized title

Candidate outlets:

- eBay seller inventory
- COMC
- CollX
- Sportlots
- Whatnot
- Shopify or CSV export
- future shoe/collectable marketplaces where terms allow import

Implementation rule:

- use official APIs, OAuth, account export files, or user-uploaded CSV/templates where available
- do not scrape accounts or bypass marketplace terms
- each outlet needs its own connector status, last sync time, import job log, and duplicate-detection report

### Future: Sports, Scores, Schedules, Odds, And Market Watchlists

The account dashboard now has the data foundation for favorite teams and market watchlists.

Sports dashboard goals:

- users can save favorite teams, leagues, and sports
- future provider jobs can populate news, scores, schedules, league links, and official-team references
- odds data must be provider-backed, jurisdiction-aware, age-gated where required, and display-only unless a future legal/compliance review approves anything more
- TCOS should prefer official league/team sites or licensed sports data providers instead of scraping

Market dashboard goals:

- users can save stocks, ETFs, indexes, crypto, NFTs, commodities, collectable indexes, and other assets
- future provider jobs can populate quotes, price history, news, NFT floor pricing, and alerts
- market data must be informational only and must not be presented as financial advice
- provider terms, licensing, freshness, and attribution must be reviewed before live display

Foundation tables:

```text
account_sports_favorites
sports_data_sources
sports_event_snapshots
sports_news_snapshots
sports_odds_snapshots
account_market_watchlist_items
market_data_sources
market_price_snapshots
market_news_snapshots
```

Current seller legal page:

```text
/seller-terms
```

Seller-account requirements:

- Truely Collectables LLC should be modeled as the storefront seller/buyer account
- David Bakanas can administer the Truely Collectables LLC account, but those seller/buyer actions must be recorded separately from Dag Danky Holdings LLC platform-admin actions
- Truely Collectables LLC must use separate login credentials and account information from Dag Danky Holdings LLC platform-admin access
- Dag Danky Shoes should be modeled as the footwear storefront seller/buyer account
- Dag Danky Shoes must use separate login credentials and account information from Dag Danky Holdings LLC platform-admin access and from Truely Collectables LLC
- sellers must accept the Seller Terms of Service before listing, auction submission, payout setup, or seller account use
- seller bank and payout information must be verified by an approved third-party payment, banking, or identity provider
- TCOS must not store raw bank credentials directly
- seller payout status must be gated by third-party verification status
- Dag Danky Holdings LLC charges a 5% seller commission/rake on third-party seller transactions
- the 5% commission is calculated from total sale amount, including item sale price plus buyer-paid shipping
- seller acceptance should be stored with seller TOS version and timestamp when seller accounts are implemented
- seller payouts must follow the approved payment processor's timing, reserve, debit, chargeback, instant payout, bank-transfer, and recovery rules unless Dag Danky Holdings LLC approves a different processor or payout method
- when a return, dispute, chargeback, authenticity case, or item-not-as-described claim is opened against a seller item, related seller funds must be held until the case and all available appeals are finally decided
- if the case is decided against the seller, TCOS policy should support recovery from held funds, future payouts, or the seller's verified payout/bank method according to payment processor rules, including recovery within three business days when supported by the provider and allowed by law

Current seller payout verification foundation:

- `/account` includes a Seller Verification panel for logged-in, active accounts
- `/seller/marketplaces` shows the seller marketplace connection dashboard with live Store #1 inventory/eBay stats and the seller-safe connector build queue
- `/api/account/seller/payout-onboarding` starts or resumes Stripe-hosted Express onboarding
- `/api/account/seller/marketplace-connections` returns seller-scoped marketplace connection records for the logged-in account
- the seller must accept Seller Terms before payout onboarding starts
- seller TOS acceptance is recorded through `tos_acceptance_events`
- Stripe collects and verifies bank/payout details; TCOS does not collect raw checking account or routing numbers
- `seller_payout_accounts` stores Stripe Connect account ID, onboarding status, payout flags, due requirements, disabled reason, and seller TOS evidence
- `seller_marketplace_connections` stores marketplace provider, seller account label, connection status, sync status, token reference/expiry metadata, last sync timing, and sync error state; it does not store raw OAuth secrets in this first foundation slice
- Stripe `account.updated` webhooks refresh seller payout status
- `account_store_memberships` gets a `seller` role with `payout_verification_required` until Stripe reports the seller payout account active

Seller constants live in:

```text
src/lib/legal.ts
```

### Future: AI Collectable Scan Assist

This is a future-build feature. It must support all collectables, not only sports cards.

Goal:

- scan or upload front/back images
- use AI to identify visible details
- match the item against outside catalog/reference sources
- show confidence and possible matches
- help estimate rarity, demand, and value
- create an educated product draft only after admin approval

The system must not rely on AI guessing alone. AI detection should propose candidates, then TCOS should compare those candidates against trusted reference and marketplace sources.

Collectable categories to support over time:

- sports cards
- trading card games
- comics
- coins
- currency
- stamps
- autographs
- memorabilia
- sealed wax/product
- toys
- graded collectables
- limited edition collectables
- other cataloged collectables

Data-source research checklist:

- find official APIs first
- confirm licensing and allowed use before storing or displaying data
- prefer catalog IDs, cert numbers, set names, card numbers, issue years, print runs, population data, and verified images
- separate catalog identity data from pricing data
- record source names, source URLs, lookup timestamps, confidence scores, and raw evidence
- never auto-list a collectable from AI recognition without admin confirmation

Candidate source categories to evaluate:

- eBay sold/active marketplace data
- PriceCharting/SportsCardsPro pricing data
- PSA certification, population, CardFacts, and auction data
- TCGplayer catalog/pricing data for trading card games
- COMC card marketplace/catalog data
- Beckett/card checklist references
- customer-authorized PSAcard.com account linking so collectors can import owned PSA-graded cards, cert data, population/card facts when permitted, and any supported account collection data
- customer-authorized Beckett.com account/subscription linking so collectors can use permitted Beckett pricing/checklist data inside their own TCOS collection dashboard
- manufacturer checklists when available
- grading-company certification lookups
- comic, coin, stamp, toy, and memorabilia catalog databases
- broad collectable catalog/reference sites such as Colnect-style catalogs
- Google Programmable Search as a fallback discovery layer

Future linked-provider portal requirements:

- build a secure connected-accounts page for collector-owned provider logins, tokens, or authorized import sessions
- never store raw third-party passwords when OAuth, API tokens, or import files are available
- encrypt any provider access tokens and separate them from public profile data
- log provider name, account owner, scopes, sync status, last sync time, and revocation status
- let collectors disconnect a provider and stop future syncs
- keep provider data source labels visible anywhere pricing or collection data is displayed
- respect each provider's licensing, subscription, caching, and redistribution rules

Future collection analytics goals:

- import PSA-owned card data into the user's collection shelf when permitted
- use Beckett subscription pricing/checklist data for the user's own dashboard when permitted
- track what the collector paid, current estimated value, realized sale price, and date sold
- show collection profit/loss, unrealized gain/loss, realized gain/loss, cost basis, current value, and performance over time
- chart collection value by category, player/character, team/franchise, set, grader, grade, and acquisition source
- support CSV/catalog exports that include provider source, paid price, current value, sold price, and profit/loss fields

Scan Assist output should include:

- likely collectable title
- category
- manufacturer/brand
- year or era
- set or series
- card/comic/coin/stamp/catalog number when available
- player/character/person/franchise
- condition clues visible from scan
- grade and cert number when visible
- serial number, autograph, patch, variant, parallel, or limited mark when visible
- rarity notes
- value range with source breakdown
- confidence score
- missing information warnings
- recommended next action

Variant and parallel resolver requirements:

- TCOS should identify the exact variation or parallel whenever visual evidence and checklist data support it
- do not show a long list of near-duplicate options when the evidence resolves the match
- if the card is a refractor, TCOS should not ask whether it is pink, blue, green, gold, base, wave, mojo, cracked ice, shimmer, lava, scope, x-fractor, atomic, numbered, or unnumbered unless the scan/checklist evidence cannot prove the answer
- use front/back scan evidence, border color, foil pattern, refractor effect, serial numbering, card number, set name, year, manufacturer, player, team, logo marks, autograph/relic markers, and visible checklist identifiers
- use online checklists and manufacturer/reference sources only where access is allowed by terms or official API
- compare visual/color clues against checklist variant names and numbering ranges
- use serial numbering to narrow parallels when the checklist defines print runs
- use back-of-card codes and fine print when visible
- collapse candidates into one selected match when confidence is high and source evidence agrees
- if multiple variants remain plausible, ask one targeted question instead of showing dozens of options
- show why TCOS picked the match, including visible clues and source evidence
- show `Needs Review` instead of guessing when evidence is incomplete
- admin approval is required before auto-listing, repricing, or publicly claiming an exact rare variant

Target identification flow:

1. Extract visible facts from images.
2. Normalize title/player/team/year/set/card number/manufacturer.
3. Query approved checklist/catalog sources.
4. Compare variant names, colors, patterns, serial-number ranges, and card numbers.
5. Score candidates by evidence match.
6. Select the exact match if one candidate is clearly supported.
7. Ask one targeted follow-up if the remaining candidates differ by a detail the image cannot prove.
8. Save evidence, confidence score, source URLs, and reviewer decision.

Future data tables should store:

- scan event
- uploaded image references
- AI extracted fields
- matched catalog candidates
- selected catalog match
- source evidence
- value estimate snapshot
- admin approval decision
- variant_resolver_runs
- variant_resolver_candidates
- variant_resolver_evidence
- checklist_source_matches

### Future: Expanded Product Detail Collector Intelligence

The first source-link version is implemented on product pages. The expanded version should make each collectable page feel alive by showing verified trend data, saved population-report snapshots, official social context, and current news without inventing hype or scraping restricted sources.

Target route:

```text
/product/[id]
```

Goal:

- show trend signals for the player, character, franchise, team, brand, or exact collectable
- show grading population reports when a grade/cert/company is known
- link to official or approved social profiles such as X, Instagram, YouTube, team pages, manufacturer pages, or franchise pages
- show relevant news or milestones when available
- explain the item's current collector story in plain language
- help the buyer understand rarity, demand, timing, and context before purchase

Collector Intelligence panel should evaluate:

- sales velocity from TCOS/eBay/comps when available
- recent sold-price movement
- watch/search activity when available from allowed sources
- player/team news such as big games, awards, trades, records, injuries, call-ups, retirements, or playoff runs
- character/franchise news such as new movie, show, game, comic arc, anniversary, limited release, or manufacturer announcement
- grading population for the exact grade when cert/set/card details are known
- related social profiles and official links
- related collector content such as manufacturer checklist, league/team bio, player page, franchise page, or grading certification page

Trending labels must be evidence-based:

- `Trending Up` only when recent source data supports it
- `Steady Demand` when comps/activity are consistent
- `Cooling Off` when recent source data supports lower demand
- `Not Enough Data` when TCOS cannot prove a trend

TCOS must not show fake urgency, fake scarcity, fake endorsements, or unsourced claims.

Grading/population report requirements:

- support PSA, CGC, SGC, Beckett/BGS, and other grading companies only when lookup access is permitted
- prefer official cert lookup or official population data
- store grading company, grade, cert number, population count, lookup URL, lookup timestamp, and source confidence
- show `population unavailable` instead of guessing
- never imply a cert is verified unless the source confirms it

Social and news requirements:

- use official APIs, official embeds, RSS feeds, licensed news/search APIs, or manually approved links
- never bypass platform limits, scraping protections, login walls, or terms
- never imply a player, team, manufacturer, grading company, league, or franchise endorses TCOS unless there is a written sponsorship/partnership
- public social links should open to the source instead of copying restricted content into TCOS
- summarize news in TCOS language with source links and timestamps
- separate factual news from AI-generated collector commentary

AI collector commentary may help write:

- why this item is interesting
- what recently happened around the player, team, character, franchise, or brand
- what a pop report means in simple terms
- why collectors may care about the grade, parallel, serial number, autograph, patch, rookie status, set, or era

AI collector commentary must:

- cite stored sources
- say when data is missing
- avoid investment advice
- avoid guaranteed future value claims
- avoid medical, legal, or financial claims
- be reviewed or source-gated before public display

Product page display should include:

- trend badge
- short collector story
- latest relevant news link list
- official social/source links
- grading pop report card when grade/cert data exists
- last updated timestamp
- source list
- `Not Enough Data` state when sources are missing

Future data tables should store:

- collectable_intelligence_snapshots
- collectable_trend_signals
- collectable_news_links
- collectable_social_links
- collectable_grading_reports
- collectable_source_evidence
- collectable_intelligence_refresh_jobs
- collectable_intelligence_admin_reviews

### Future: Brag Session And Collection Board

This is a future-build community feature. It should not copy eBay-style transactional feedback.

TCOS community ratings should use collector-style tiers:

- `Gold`
- `Silver`
- `Bronze`

These tiers should represent post-purchase collector satisfaction, community trust, and brag-session quality after moderation rules exist. They should not be implemented as a direct eBay positive/neutral/negative clone.

Goal:

- give buyers a fun way to show off what they received
- let collectors post collection photos, mail days, favorites, displays, and stories
- build community around collectables instead of only buyer/seller ratings
- keep transaction issues, chargebacks, and evidence packets separate from public community posts

Buyer post-purchase flow:

- after delivery, invite the buyer to create a `Brag Session`
- buyer can upload photos of the item or collection
- buyer can add title, story, category, tags, and optional order/item link
- buyer can choose public, private, or admin-review-only visibility
- public posts must go through moderation before appearing

Collection board:

- users can show collection shelves, slabs, binders, sealed product, memorabilia, or themed collections
- posts can be grouped by category, sport, franchise, player, set, era, or custom tags
- users can like/save/comment only after community safety controls are built
- admin can feature posts on storefront/community pages

Safety and moderation rules:

- no addresses, tracking labels, order numbers, phone numbers, payment details, or private customer information in public posts
- image uploads must be scanned/moderated before public display
- admin must be able to approve, hide, remove, or feature posts
- reporting tools should exist before public comments go live
- public community posts must not expose chargeback evidence, IP evidence, TOS audit records, or private order records
- community reputation must stay separate from seller compliance, payout, fraud, and transaction evidence workflows

Future data tables should store:

- community profile
- brag session post
- collection board post
- post images
- post moderation status
- tags/categories
- optional order item reference
- likes/saves/comments after moderation is ready
- abuse reports and admin actions

### Future: Trades And Collector Swaps

This is a future-build marketplace/community feature. It should let collectors propose trades safely after buyer/seller accounts, identity controls, moderation, shipping evidence, and dispute rules exist.

Goal:

- let collectors mark items as open for trade
- let collectors build trade offers from their collection
- support one-for-one and multi-item trade proposals
- support cash difference only if payments, tax, and dispute rules are designed
- give each side a clear trade review screen before accepting
- protect both parties with identity, address, shipping, condition, and evidence controls
- keep trades separate from normal store inventory until a trade is accepted and locked

Trade section entry points to evaluate:

- `/trades` public trade browsing page
- product page `Open To Trade` signal when the owner allows it
- user collection item `Trade This` action
- want ad match to trade offer
- admin trade review queue
- post-purchase prompt to add an item to collection/trade board after delivery

Trade offer data should include:

- initiating user
- receiving user
- offered item list
- requested item list
- optional cash difference only if enabled
- item photos
- condition notes
- grade/cert details when available
- declared value from comps when available
- shipping method
- tracking numbers for both sides
- trade status
- timestamps for offer, counter, acceptance, shipment, delivery, dispute, and completion

Required safety rules:

- require user accounts before trades can exist
- require TOS acceptance for trade terms
- require verified email and recommended multi-factor authentication
- do not expose addresses until both sides accept and shipping flow requires it
- keep address and identity data private
- require item condition photos before acceptance
- record IP/user-agent evidence for trade acceptance events
- require tracking on both shipments
- allow admin freeze/review on suspicious trade activity
- prohibit off-platform payment pressure, scams, harassment, counterfeit claims, and unsafe meetups
- provide report/dispute tools before public trading goes live

Trade fulfillment models to evaluate:

- direct ship: both collectors ship to each other with tracking
- admin-mediated trade: both collectors ship to TCOS first, TCOS verifies, then forwards
- local meetup: future option only if safety, location privacy, and event rules are designed

Admin-mediated trade is safer but operationally heavier. Direct ship is easier but higher risk. TCOS should not enable public trades until the chosen model has clear rules, evidence packets, and dispute handling.

Trade evidence packets should store:

- accepted trade terms
- TOS version
- IP/user-agent evidence
- item photos at acceptance
- declared condition and value
- shipping labels/tracking
- delivery proof
- user messages related to the trade
- admin actions
- dispute notes

Future data tables should store:

- trade_profiles
- trade_items
- trade_offers
- trade_offer_items
- trade_offer_messages
- trade_acceptance_events
- trade_shipments
- trade_evidence_packets
- trade_disputes
- trade_admin_reviews
- trade_terms_acceptance

### Future: Collector Map, Card Shows, And Shop Finder

This is a future-build discovery feature. It should help collectors find card shows, collectable shows, local card shops, hobby stores, trade nights, release events, grading events, and community meetups near them.

Goal:

- search by ZIP code, city, state, or current location with consent
- show nearby card shops and collectable shops on a map
- show upcoming card shows and collectable events by radius
- support geofenced regions for promoted local events
- use AI to help discover and normalize show/event information from permitted sources
- help collectors plan where to go, what to bring, and whether an event fits their collecting interests

Collector search should support:

- ZIP code
- city/state
- radius
- date range
- category, such as sports cards, TCG, comics, coins, toys, memorabilia, autographs, or mixed collectables
- event type, such as show, trade night, signing, release, grading submission event, shop event, or auction preview
- shop/event name
- free/paid admission
- family-friendly flag
- vendor/table information when available

Map and data-source candidates to evaluate:

- Google Maps Platform Places API for shop/place discovery
- Google Maps Geocoding API for ZIP/city lookup
- Mapbox or similar map provider as an alternate map/search provider
- Eventbrite or other event APIs where terms allow event discovery
- promoter-submitted event listings
- shop-owner submitted listings
- admin-entered shows and shops
- Google Programmable Search as a fallback discovery layer
- public show calendars where licensing/terms allow use
- social/event advertising sources only when access is permitted by their terms or an official API

AI event discovery should:

- parse event title, location, dates, times, promoter, admission, vendor tables, categories, and source URL
- deduplicate repeated listings for the same show
- assign confidence scores
- flag missing or conflicting details
- require admin approval before publishing uncertain events
- keep raw source evidence and lookup timestamps

Geofencing and promotion rules:

- geofenced promotions should use ZIP, city, radius, or coarse region targeting by default
- precise location should require clear user consent
- do not store exact user location unless the feature truly needs it and the user has opted in
- allow collectors to search by ZIP without enabling device location
- disclose when a result is sponsored or promoted
- keep sponsored placement separate from organic relevance
- never sell or expose private user location data

Collector-facing event pages should include:

- event/shop name
- address and map
- date/time
- distance from searched area
- event category
- admission cost
- promoter/shop contact link when available
- source link
- confidence/verification status
- last verified timestamp
- notes for collectors
- related nearby shops/events

Future data tables should store:

- shops
- shows/events
- event venues
- promoters
- event categories
- geofenced promotion campaigns
- source evidence
- verification status
- admin approvals
- user saved events
- opt-in location preferences

### Future: AI Search, Want Ads, And Site Help

This is a future-build discovery and support feature.

Goal:

- help collectors find the exact item they want
- understand natural-language collector searches
- recommend matching products, categories, saved searches, shows, shops, and content
- create a Want Ad when TCOS does not have the item
- help users navigate the site and answer technical questions
- escalate support questions to a future technical support email inbox when AI cannot answer safely

AI search should support:

- player/person/character/franchise
- year, set, brand, card number, issue number, catalog number, cert number, or serial number
- sport/category
- grade, condition, raw/graded/sealed
- autograph, patch, parallel, variant, refractor, short print, rookie, insert, or limited mark
- price range
- seller-owned inventory when seller accounts exist
- active storefront products
- sold/reference/comps context when useful
- collector intent, such as buying, researching, completing a set, finding a gift, or valuing an item

Search behavior:

- return direct product matches first
- show close matches and explain why they match
- show confidence and missing details
- ask clarifying questions when the request is ambiguous
- do not invent facts or pretend an item is available
- offer to create a Want Ad if no suitable item is found

Want Ads:

- run for 30 days by default
- can be renewed by the user
- should expire automatically if not renewed
- should support status values such as active, matched, expired, renewed, canceled, and fulfilled
- should allow item details, category, desired condition/grade, budget, notes, and optional images
- should notify admin when a new Want Ad is created
- should notify the user when matching inventory appears
- should not publicly expose private email, phone, address, IP, payment, or account details
- should be moderated before public/community display if Want Ads become public

AI site help should:

- answer site navigation questions
- explain how checkout, offers, tracking, orders, TOS, evidence/security, and community features work
- guide collectors to product pages, cart, orders, Brag Sessions, Collection Board, shows/shops, and support
- avoid legal, tax, medical, financial, or authentication-sensitive claims beyond approved policy text
- avoid exposing private admin, customer, seller, payout, IP, or evidence data
- escalate unresolved technical issues to support

Technical support escalation:

- future env var should define the support inbox
- likely name: `TECHNICAL_SUPPORT_EMAIL`
- user should be able to submit name, email, issue type, order ID if relevant, and message
- AI conversation context should be summarized, not forwarded with private hidden data
- support submissions should be saved for admin review
- email forwarding should be added after the support mailbox is chosen

Future data tables should store:

- ai_search_sessions
- ai_search_messages
- want_ads
- want_ad_matches
- want_ad_renewals
- support_requests
- support_request_messages
- support_email_delivery_status

### Future: Sponsorships, Advertising, And Partner Outreach

This is a future-build revenue feature. It should help TCOS sell advertising and sponsorship placements to collectable-related companies without creating spam, privacy risk, or low-quality ads.

Goal:

- create advertising inventory on TCOS
- sell logo placements, sponsored placements, newsletter spots, show/shop placements, and category sponsorships
- help collectable companies reach collectors through relevant pages
- create a compliant sponsor outreach workflow
- track leads, conversations, packages, contracts, payment status, creative assets, start/end dates, and performance

Potential sponsor categories:

- card shops
- card show promoters
- grading companies
- supplies companies
- storage/display companies
- auction houses
- breakers and stream sellers
- collectable insurance companies
- memorabilia companies
- comic, coin, toy, stamp, and TCG businesses
- local shops promoted by ZIP, city, state, radius, or event category

Ad inventory to evaluate:

- homepage sponsor block
- shop/category sponsor block
- product-page related sponsor block
- Collector Map sponsor pins
- card show/event sponsor placement
- Brag Session/Collection Board sponsor placements after moderation tools exist
- newsletter/email sponsor slot after subscriber consent tools exist
- admin-approved banner/logo placements

Sponsor packages should define:

- placement
- audience/category
- region or geofence
- price
- duration
- impressions/clicks when tracking is built
- creative/logo requirements
- prohibited content
- approval workflow
- renewal rules

Outreach rules:

- do not scrape or harvest email addresses in ways that violate laws, terms, or platform rules
- do not send deceptive mass email
- use truthful sender identity, subject lines, and offer language
- include Dag Danky Holdings LLC / Truely Collectables contact information
- include a valid physical mailing address when sending commercial outreach
- include a clear opt-out/unsubscribe method
- honor opt-out requests within 10 business days
- keep a suppression list and never email suppressed contacts again except as required for compliance
- separate one-to-one relationship outreach from marketing blasts
- prefer warm leads, opt-in lists, business cards, show contacts, inbound sponsor forms, and manually verified public business contacts

TCOS can help with:

- sponsor media kit copy
- rate card
- sponsorship package definitions
- compliant outreach email templates
- lead tracker
- outreach status pipeline
- follow-up reminders
- opt-out/suppression tracking
- sponsor asset uploads
- ad placement scheduling
- invoice/payment tracking
- performance reporting after analytics is built

TCOS should not send sponsor outreach until:

- `SPONSOR_OUTREACH_FROM_EMAIL` is configured
- `SPONSOR_OUTREACH_REPLY_TO_EMAIL` is configured
- `SPONSOR_OUTREACH_PHYSICAL_ADDRESS` is configured
- opt-out handling is built
- suppression list handling is built
- a reviewed outreach template is approved
- contacts are sourced and verified through allowed methods

Reference:

- [FTC CAN-SPAM Act Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

Future data tables should store:

- sponsors
- sponsor_contacts
- sponsor_leads
- sponsor_outreach_messages
- sponsor_outreach_suppression_list
- sponsor_packages
- ad_placements
- ad_creatives
- ad_campaigns
- ad_impressions
- ad_clicks
- sponsor_invoices
- sponsor_payments

### Future: Marketing Campaigns, Social Posting, And Collectable Of The Day

This is a future-build promotion feature. It should help TCOS advertise the website, promote listings, and keep social channels active without spam, fake engagement, deceptive posting, or platform policy problems.

Goal:

- create organized advertising campaigns for TCOS
- schedule approved promotional posts across connected social channels
- automatically feature a Collectable of the Day
- generate platform-specific captions, hashtags, and safe tags
- promote store listings, card shows, sponsor campaigns, collection posts, want ads, and major inventory drops
- track campaign status, approvals, channels, post history, clicks, conversions, and engagement
- avoid repetitive posting, unwanted tagging, or random website posting that looks like spam

Supported campaign types to evaluate:

- Collectable of the Day
- new inventory drop
- featured category
- local card show or shop spotlight
- sponsor spotlight
- holiday/event promotion
- price drop
- buyer brag/collection highlight after customer permission
- want ad spotlight
- newsletter promotion after subscriber consent tools exist

Collectable of the Day automation should:

- select one eligible product per day from active inventory
- avoid sold, hidden, draft, or blocked products
- prefer items with strong photos, clean title, price, category, and description
- create a short caption for each connected platform
- generate hashtags from product title, category, brand, manufacturer, player, team, set, year, grade, sport, franchise, rarity, and condition
- tag manufacturers, teams, players, leagues, or brands only when the tag is accurate, relevant, and not excessive
- avoid tagging companies or public figures repeatedly just to force attention
- include the product link and clear call to action
- support admin preview and approval before publishing
- record exactly what was posted, where it was posted, and when it was posted

Posting controls should include:

- enabled channels
- posting calendar
- daily/weekly posting limits
- quiet hours
- duplicate detection
- campaign approval status
- link tracking
- image selection
- generated caption review
- generated hashtag review
- generated tag review
- failure/retry handling
- admin override

Web and community promotion rules:

- do not randomly post to unrelated websites
- do not bypass moderation, captchas, posting limits, or site rules
- do not use bots to create fake engagement, fake comments, or fake accounts
- post only where TCOS has permission, an account, an official integration, or clear allowed community participation
- respect each site's terms, community rules, rate limits, and promotional posting policies
- keep a record of where TCOS is allowed to post and what kind of promotion is allowed there
- prefer official APIs, approved social integrations, owned channels, paid advertising accounts, newsletters, and permission-based communities

Social channels to evaluate:

- Facebook page and groups where promotion is allowed
- Instagram business account
- TikTok business account
- X account
- YouTube Shorts
- Pinterest
- LinkedIn company page for sponsor/business updates
- Reddit only in communities where promotional posting is allowed by the subreddit rules
- Discord servers only where the server owner permits promotions
- email newsletter after subscriber consent tools exist

Campaign copy should be generated in the TCOS voice:

- collector-first
- accurate
- excited but not misleading
- no fake scarcity
- no fake endorsements
- no unsupported price claims
- no unauthorized claim that a player, manufacturer, team, league, or brand sponsors TCOS

TCOS should not publish automated posts until:

- at least one official social account is connected
- platform API access or posting method is approved
- admin approval workflow is built
- duplicate/spam controls are built
- channel-specific rules are saved
- link tracking is configured
- image/caption/tag review is enabled
- opt-in newsletter consent exists for email campaigns

Future data tables should store:

- marketing_campaigns
- marketing_campaign_channels
- marketing_campaign_posts
- marketing_campaign_assets
- marketing_campaign_post_approvals
- marketing_campaign_post_metrics
- collectable_of_the_day_candidates
- collectable_of_the_day_posts
- social_accounts
- social_channel_rules
- social_posting_limits
- social_post_failures
- campaign_link_clicks

## 23. Security And Data Protection

Security is required for owner, buyer, and seller data.

Current implemented protections:

- admin sessions use a signed HTTP-only cookie instead of a plain `true` cookie
- admin session cookies are secure, same-site lax, and expire after 24 hours
- site usage can be blocked when VPN, proxy, Tor, relay, hosting, or anonymous IP risk is detected
- blocked site users see: `Sorry, you must turn off your proxy or VPN to use this website.`
- admin pages are protected by `src/proxy.ts`
- sensitive admin-style API routes are protected by the same admin session
- security headers are applied globally from `src/proxy.ts`
- admin/API responses are marked `no-store`
- Stripe webhooks require Stripe signature verification
- customer TOS acceptance is required before checkout and offer submission
- customer TOS acceptance records the server-observed public IP, user agent, IP risk, and request header evidence
- checkout creates a `tos_acceptance_events` audit row before Stripe checkout is created
- completed transactions create `transaction_evidence_reports` for chargeback/legal packets
- offer submission stores TOS/IP evidence before the offer is accepted
- public offer submission validates product ID, customer name, customer email, offer amount, and current inventory availability before saving the offer
- public checkout is rate-limited to 12 attempts per 10 minutes per IP/account subject when `public_endpoint_rate_limit_events` is migrated
- public offer creation is rate-limited to 8 attempts per 15 minutes per IP/customer/product subject
- collector binding-offer payment setup is rate-limited to 6 attempts per hour per IP/account subject
- seller payout onboarding is rate-limited to 5 attempts per hour per IP/account subject
- `/admin/security` shows recent public money-path events, blocked events, watch events, unique IPs, endpoint counts, identity risk, and header evidence summary
- `/admin/security/ip/[ip]` shows a focused dossier for one IP across login attempts, money-path attempts, TOS events, orders, offers, and transaction evidence reports
- `/admin/security/ip/[ip]` lets admins save a persistent investigation status, severity, and internal notes
- `/admin/launch-readiness` checks whether the public endpoint rate-limit audit table is available
- `/admin/launch-readiness` checks whether the security IP investigation table is available
- buyer account signup starts accounts in `payment_verification_required` status when card verification is required
- Stripe Checkout setup mode collects the buyer card and billing address before TCOS activates the account
- signed Stripe webhook completion marks the account active only when Stripe returns a card payment method with complete United States billing address evidence; otherwise the account stays pending
- TCOS stores Stripe-safe card proof, such as customer ID, setup intent ID, payment method ID, card brand, last 4, expiry, funding type, billing name, billing address fields, billing country, billing postal code, verification check timestamp, and failure reason when applicable
- pending card-verification accounts cannot log in or use authenticated account APIs as active customers
- buyer account signup can proceed to Stripe verification when configured identity checks detect VPN, proxy, Tor, relay, hosting, or anonymous IP use; buyer login and money-path routes remain subject to identity controls
- buyer account signup/login locks out repeated failures after six failed attempts inside 15 minutes
- bank credentials are not stored in TCOS

Buyer-account anti-fraud requirement:

- buyer/customer account signup requires a valid payment card and billing/address evidence through Stripe unless `ACCOUNT_CARD_VERIFICATION_REQUIRED=false`
- card verification requires complete United States billing address evidence before account activation
- failed or canceled card verification prevents account activation and login
- TCOS must never store raw card numbers, CVV, or payment credentials

Important IP rule:

TCOS can log and enforce the server-observed public client IP. If a customer hides behind a VPN, proxy, Tor, relay, or hosting network, TCOS cannot discover the hidden residential IP by itself. Production masking detection requires a third-party IP intelligence provider configured through environment variables.

Routes currently protected by admin session:

- `/admin/*`
- `/ebay/*`
- `/api/admin/*` except `/api/admin/login`
- `/api/ebay/*`
- `/api/orders/*`
- `/api/offers/update-status`
- `/api/offers/counter`

Public routes that must remain public:

- `/shop`
- `/product/[id]`
- `/cart`
- `/terms`
- `/seller-terms`
- `/api/checkout`
- `/api/offers/create`
- `/api/account/collector/binding-offers`
- `/api/account/seller/payout-onboarding`
- `/api/account/seller/marketplace-connections`
- `/api/webhook`
- `/api/stripe/webhook`

Webhook routes are exempt from the site-wide identity gate so Stripe can deliver signed webhook events.

Required future seller-account protections:

- use a real identity/auth provider for buyer and seller accounts
- require email verification before buying or selling account use
- require multi-factor authentication for sellers and admins
- use a third-party provider for bank verification and payouts
- store only provider IDs, verification status, timestamps, and non-sensitive payout metadata
- never store raw bank account numbers, routing numbers, SSNs, tax IDs, passwords, or payment card data in TCOS
- encrypt sensitive internal notes or documents if they are ever added
- restrict seller data so one seller cannot read another seller's account, payout, auction, or customer data
- audit seller-account changes, payout changes, bank verification changes, and admin overrides
- add fraud review and payout hold controls before seller payouts go live

Security files:

```text
src/lib/admin-session.ts
src/lib/client-identity.ts
src/lib/public-endpoint-rate-limit.ts
src/lib/tos-acceptance.ts
src/proxy.ts
```

## 24. Clean Fake Orders

To clear fake local orders, run this in Supabase SQL Editor:

```sql
truncate table order_items, orders restart identity cascade;
```

This clears only local orders.

It does not delete:

- products
- inventory
- eBay listings
- eBay inventory
- offers
- eBay tokens

If fake orders reduced quantity, run eBay sync afterward.

## 25. Environment Variables

Core:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=
```

Admin:

```env
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
```

Stripe:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

eBay:

```env
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_ENVIRONMENT=production
```

Email:

```env
RESEND_API_KEY=
TRANSACTION_EVIDENCE_EMAIL=
TRANSACTION_EVIDENCE_FROM=
TECHNICAL_SUPPORT_EMAIL=
```

`TRANSACTION_EVIDENCE_EMAIL` is the fallback destination address for transaction evidence PDFs when `store_settings.evidence_email` is not set. `TRANSACTION_EVIDENCE_FROM` is optional and defaults to the store evidence sender. `TECHNICAL_SUPPORT_EMAIL` is the fallback support inbox when `store_settings.support_email` is not set.

AI descriptions:

```env
OPENAI_API_KEY=
OPENAI_DESCRIPTION_MODEL=
```

Optional comps:

```env
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
PRICECHARTING_API_TOKEN=
```

IP intelligence and masked-identity blocking:

```env
IP_INTELLIGENCE_API_URL=
IP_INTELLIGENCE_API_KEY=
IP_INTELLIGENCE_REQUIRED=true
```

`IP_INTELLIGENCE_API_URL` may contain `{ip}` as a placeholder. If `IP_INTELLIGENCE_REQUIRED=true`, TCOS blocks site/API usage when the provider is missing, unavailable, or reports VPN/proxy/Tor/hosting/anonymous risk.

Reference links:

- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Supabase project settings](https://supabase.com/docs)
- [Stripe docs](https://docs.stripe.com/)
- [eBay developer keys](https://developer.ebay.com/develop)
- [Google Programmable Search JSON API](https://developers.google.com/custom-search/v1/overview)
- [OpenAI API docs](https://platform.openai.com/docs/api-reference)

## 26. Database Tables

Legacy compatibility:

- `products`
- `orders`
- `order_items`
- `offers`
- `ebay_tokens`

TCOS V2:

- `inventory_items`
- `inventory_images`
- `inventory_attributes`
- `ebay_sync_decision_events`
- `sales_comp_snapshots`
- `tos_acceptance_events`
- `transaction_evidence_reports`
- `security_ip_investigations`

See:

```text
docs/DATABASE_DOCUMENTATION.md
```

## 27. Migrations

Migration directory:

```text
supabase/migrations
```

Current migration:

```text
20260701074500_add_account_billing_address_evidence.sql
20260630123000_create_ebay_sync_decision_events.sql
20260630120000_create_security_ip_investigations.sql
20260630113000_create_public_endpoint_rate_limit_events.sql
20260630110000_create_inventory_sale_decrement_rpc.sql
20260629083000_create_inventory_v2_app_policies.sql
20260629080000_grant_inventory_v2_table_access.sql
20260628223000_create_collector_profiles_messaging_exports.sql
20260628220000_create_collector_dashboard_tables.sql
20260628213000_create_sports_dashboard_tables.sql
20260628201500_add_account_auth_lockouts.sql
20260628193000_link_accounts_to_orders_offers.sql
20260628190000_create_tcos_accounts.sql
20260628180000_create_admin_login_attempts.sql
20260628114000_create_inventory_tables.sql
20260628113000_create_store_settings.sql
20260628110000_create_tcos_stores.sql
20260627160000_create_sales_comp_snapshots.sql
20260627170000_add_tos_acceptance_to_orders_offers.sql
20260627173000_add_tos_identity_evidence.sql
20260627180000_create_transaction_evidence_reports.sql
```

Apply migrations before using features that depend on new tables.

Reference:

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)

## 28. Build And Verification

Run:

```bash
npm run build
```

Expected:

- compile succeeds
- TypeScript succeeds
- route generation succeeds

Use this before deploy or after feature changes.

Reference:

- [Next.js docs](https://nextjs.org/docs)

## 29. Safe Operating Rules

Do:

- use admin status buttons instead of deleting products
- use eBay sync to restore stock from eBay
- check comps before repricing important cards
- apply suggested price only after reviewing comps
- update tracking before marking shipped

Do not:

- delete eBay tokens casually
- delete inventory rows manually
- assume clearing orders restores quantity
- assume AI descriptions know card facts not entered in TCOS
- scrape pricing sites without permission/API

## 30. Troubleshooting

### Admin redirects to login

Cookie is missing or expired. Log in again.

### Checkout says not enough inventory

Check product status and quantity on `/admin/products/[id]`.

### Product does not show in shop

Check:

- status is `active`
- quantity is above zero
- price is above zero

### eBay sync fails

Check:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `ebay_tokens` has a refresh token
- eBay API scopes are valid

### Sales comps do not save

Apply:

```text
supabase/migrations/20260627160000_create_sales_comp_snapshots.sql
```

### Google comps show not configured

Set:

```env
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
```

### PriceCharting shows not configured

Set:

```env
PRICECHARTING_API_TOKEN=
```

### AI description falls back to local

Check:

```env
OPENAI_API_KEY=
OPENAI_DESCRIPTION_MODEL=
```

## 31. Developer Map

Inventory:

```text
src/modules/inventory
```

eBay, comps, pricing:

```text
src/lib/ebay.ts
```

Checkout:

```text
src/app/api/checkout/route.ts
```

Terms of Service:

```text
src/lib/legal.ts
src/app/terms/page.tsx
supabase/migrations/20260627170000_add_tos_acceptance_to_orders_offers.sql
```

Stripe webhooks:

```text
src/app/api/webhook/route.ts
src/app/api/stripe/webhook/route.ts
```

Transaction evidence:

```text
src/lib/evidence-pdf.ts
src/lib/transaction-evidence.ts
src/app/admin/files/page.tsx
src/app/api/admin/files/[id]/download/route.ts
supabase/migrations/20260627180000_create_transaction_evidence_reports.sql
```

Admin product screens:

```text
src/app/admin/products/page.tsx
src/app/admin/products/new/page.tsx
src/app/admin/products/[id]/page.tsx
```

Accounts:

```text
src/app/admin/accounts/page.tsx
src/app/account
src/app/api/account
src/lib/account-auth.ts
src/lib/account-profiles.ts
supabase/migrations/20260628213000_create_sports_dashboard_tables.sql
```

Orders:

```text
src/app/admin/orders
src/app/api/orders
```

Offers:

```text
src/app/admin/offers
src/app/api/offers
```

## 32. Maintenance Rule

When a feature changes, update this manual in the same work session.

PDF generation can wait until the end of a completed module or lane so development can move faster. Keep the Markdown manual current during implementation, then run `npm run manual:pdf` at the module checkpoint.

Every generated manual PDF, including the future separate mobile app manual PDF, must watermark each page with `Property of Dag Danky Holdings LLC.`.

Checklist for future changes:

1. Update feature behavior section.
2. Update route list if routes changed.
3. Update environment variables if new keys are added.
4. Update database docs if tables/fields change.
5. Update the mobile app manual when the change affects the mobile app.
6. Regenerate the correct PDF manual at the module checkpoint.
7. Run `npm run build`.

The app should not get ahead of the documentation.
