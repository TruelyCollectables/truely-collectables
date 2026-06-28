# TCOS Database Documentation

Copyright 2026 Dag Danky Holdings LLC. All rights reserved.

Authored by David Bakanas.

Software ownership: Dag Danky Holdings LLC.

Last updated: 2026-06-27

This document records the database shape TCOS expects.

Totally Collectibles OS (TCOS) software ownership belongs to Dag Danky Holdings LLC. Truely Collectables is Store #1 inside TCOS.

Operator workflow lives in:

- [TCOS Operator Manual](TCOS_OPERATOR_MANUAL.md)

## Database Ownership Rules

Normal admin changes should go through the app, not raw SQL.

Use raw SQL only for:

- migrations
- emergency cleanup
- one-time repair
- confirmed fake-data removal

## Security Data Rules

Do not store raw bank account numbers, routing numbers, payment card numbers, SSNs, tax IDs, or seller payout credentials in TCOS.

Future seller payout and bank verification must use an approved third-party provider. Store only provider IDs, verification status, timestamps, payout state, and non-sensitive metadata needed for operations.

## Legacy Compatibility Tables

## Multi-Store Platform Tables

### `stores`

Platform storefront table.

Created by migration:

```text
supabase/migrations/20260628110000_create_tcos_stores.sql
```

Store #1 is fixed as:

| Field | Value |
| --- | --- |
| `id` | `00000000-0000-4000-8000-000000000001` |
| `slug` | `truely-collectables` |
| `display_name` | `Truely Collectables` |
| `legal_name` | `Truely Collectables LLC` |
| `store_type` | `collectables` |
| `platform_owner` | `Dag Danky Holdings LLC` |

The same migration adds `store_id` to current core tables and defaults existing/current inserts to Store #1.

Tables with `store_id` foundation:

- `products`
- `inventory_items`
- `orders`
- `order_items`
- `offers`
- `ebay_tokens`
- `sales_comp_snapshots`
- `tos_acceptance_events`
- `transaction_evidence_reports`

Current Store #1 constants and active-store helpers live in `src/lib/stores.ts`. Store operational settings resolve through `src/lib/store-settings.ts`. Current create/upsert paths pass the active store ID for products, inventory items, orders, order items, offers, eBay tokens, sales comp snapshots, TOS acceptance events, and transaction evidence reports. Current inventory, eBay token, sales comp, fulfillment, offer, evidence, admin, and success-page read/update paths are also scoped to the active store. The inventory repository and inventory engine carry store context internally. Future multi-store work should replace the current Store #1 resolver with request/account/domain-selected store context for all customer, product, inventory, order, offer, integration, and evidence queries.

### `store_settings`

Per-store operational settings table.

Created by migration:

```text
supabase/migrations/20260628113000_create_store_settings.sql
```

Fields:

| Field | Purpose |
| --- | --- |
| `store_id` | Store ID and primary key |
| `support_email` | Store support inbox |
| `sales_email` | Store sales/admin inbox |
| `offers_email` | Sender email for offer notifications |
| `evidence_email` | Destination for transaction evidence PDFs |
| `evidence_from_email` | Sender for evidence emails |
| `order_from_email` | Sender for order/shipping/customer emails |
| `stripe_mode` | Current store payment mode hint, such as env, test, or live |
| `stripe_account_id` | Future connected Stripe account ID |
| `ebay_environment` | eBay environment for the store |
| `ebay_account_label` | Human-readable eBay account label |
| `seller_commission_rate` | Platform commission rate for seller transactions |
| `metadata` | Future settings JSON |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

Runtime behavior:

- TCOS reads settings through `src/lib/store-settings.ts`.
- If settings are missing or the table is not migrated yet, TCOS falls back to Store #1 defaults and current environment variables.
- Transaction evidence, shipping emails, offer notifications, launch readiness, and support/email display should use resolved store settings instead of hardcoded Store #1 values.

### `products`

Legacy product table. Still required.

Used by:

- shop display compatibility
- product relationships in offers/order items
- eBay import compatibility
- V2 bridge through `legacy_product_id`

Fields expected by current code:

| Field | Purpose |
| --- | --- |
| `id` | Legacy product ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `sku` | eBay/local SKU when available |
| `title` | Product title |
| `description` | Product description |
| `player` | Player name |
| `sport` | Sport/category search value |
| `price` | Storefront price |
| `quantity` | Legacy mirrored quantity |
| `image_url` | Primary storefront image |
| `ebay_item_id` | eBay listing ID |
| `last_seen_at` | Last eBay import timestamp |
| `created_at` | Product creation timestamp |

### `orders`

Stores order headers.

Fields used by current code:

| Field | Purpose |
| --- | --- |
| `id` | Order ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `created_at` | Order creation timestamp |
| `customer_email` | Customer email |
| `customer_name` | Customer name |
| `total` | Total paid |
| `status` | Payment status |
| `stripe_session_id` | Stripe checkout session ID |
| `shipping_method` | Internal shipping method |
| `shipping_name` | Display shipping name |
| `shipping_amount` | Shipping paid |
| `subtotal` | Item subtotal |
| `item_count` | Total item count |
| `fulfillment_status` | Fulfillment status |
| `tracking_number` | Tracking number |
| `carrier` | Shipping carrier |
| `shipped_at` | Shipment timestamp |
| `customer_notes` | Optional notes |
| `discount_amount` | Optional discount amount |
| `discount_code` | Optional discount code |
| `shipping_address_line1` | Address line 1 |
| `shipping_address_line2` | Address line 2 |
| `shipping_city` | City |
| `shipping_state` | State |
| `shipping_postal_code` | Postal code |
| `shipping_country` | Country |
| `tos_accepted` | Whether customer accepted Terms of Service |
| `tos_version` | Terms of Service version accepted |
| `tos_accepted_at` | TOS acceptance timestamp |
| `tos_acceptance_event_id` | Linked TOS/IP audit event |
| `tos_ip_address` | Server-observed client IP at acceptance |
| `tos_user_agent` | User agent at acceptance |
| `tos_ip_risk` | IP intelligence status |
| `tos_ip_block_reason` | Block reason if applicable |
| `tos_ip_evidence` | Request header evidence JSON |

### `order_items`

Stores order line items.

Fields used by current code:

| Field | Purpose |
| --- | --- |
| `id` | Order item ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `order_id` | Parent order |
| `product_id` | Legacy product ID |
| `title` | Purchased item title snapshot |
| `price` | Purchased item price snapshot |
| `quantity` | Quantity purchased |

### `offers`

Stores customer offers.

Fields used by current code:

| Field | Purpose |
| --- | --- |
| `id` | Offer ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `product_id` | Legacy product ID |
| `customer_name` | Customer name |
| `customer_email` | Customer email |
| `offer_amount` | Original offer |
| `counter_amount` | Counter amount if any |
| `status` | Offer status |
| `stripe_checkout_url` | Payment URL |
| `stripe_session_id` | Stripe session |
| `tos_accepted` | Whether customer accepted Terms of Service |
| `tos_version` | Terms of Service version accepted |
| `tos_accepted_at` | TOS acceptance timestamp |
| `tos_acceptance_event_id` | Linked TOS/IP audit event |
| `tos_ip_address` | Server-observed client IP at acceptance |
| `tos_user_agent` | User agent at acceptance |
| `tos_ip_risk` | IP intelligence status |
| `tos_ip_block_reason` | Block reason if applicable |
| `tos_ip_evidence` | Request header evidence JSON |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

Known statuses in current flows:

- `pending`
- `accepted`
- `declined`
- `countered`
- `paid`

### `ebay_tokens`

Stores eBay refresh tokens.

Fields used:

| Field | Purpose |
| --- | --- |
| `id` | Token row ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `refresh_token` | eBay OAuth refresh token |
| `created_at` | Token creation timestamp |

Do not delete unless intentionally reconnecting eBay.

## TCOS V2 Inventory Tables

### `inventory_items`

Main V2 inventory table.

Fields expected by current code:

| Field | Purpose |
| --- | --- |
| `id` | V2 inventory item ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `legacy_product_id` | Bridge to `products.id` |
| `sku` | SKU |
| `title` | Inventory title |
| `description` | Inventory description |
| `category` | Category/sport |
| `condition` | Condition text |
| `status` | Inventory status |
| `quantity` | Authoritative V2 quantity |
| `cost` | Optional cost basis |
| `price` | Authoritative V2 price |
| `currency` | Currency, usually USD |
| `location` | Optional storage location |
| `notes` | Internal notes |
| `created_at` | Created timestamp |
| `updated_at` | Updated timestamp |

Allowed statuses:

- `draft`
- `active`
- `reserved`
- `sold`
- `archived`

### `inventory_images`

Image table for V2 inventory.

Fields expected:

| Field | Purpose |
| --- | --- |
| `id` | Image ID |
| `inventory_item_id` | Parent V2 inventory item |
| `image_url` | Image URL |
| `alt_text` | Alt text |
| `sort_order` | Sort order |
| `is_primary` | Primary image flag |
| `created_at` | Created timestamp |

### `inventory_attributes`

Future structured card attributes.

Fields expected:

| Field | Purpose |
| --- | --- |
| `id` | Attribute ID |
| `inventory_item_id` | Parent V2 inventory item |
| `attribute_name` | Attribute name |
| `attribute_value` | Attribute value |
| `created_at` | Created timestamp |

## Inventory Bridge Operations

Inventory bridge logic lives in:

```text
src/modules/inventory/engine.ts
```

Current bridge methods:

| Method | Purpose |
| --- | --- |
| `getBridgeStatus()` | Compares Store #1 `products` against `inventory_items` and returns reconciliation rows |
| `backfillInventoryItemsFromProducts()` | Creates or updates V2 inventory rows from legacy products |
| `getEbayReconciliationStatus()` | Builds the local eBay listing health view from Store #1 product sync fields |

Admin screen:

```text
src/app/admin/inventory/page.tsx
```

Backfill behavior:

- scans active-store `products`
- matches an existing V2 item by `legacy_product_id`
- falls back to active-store SKU match when no legacy bridge exists
- creates missing V2 rows
- updates existing V2 rows with product title, description, category, status, quantity, price, SKU, and legacy product ID
- copies missing product images into `inventory_images`
- records per-row failures instead of stopping the whole run

Checkout availability behavior:

- `inventoryEngine.requireAvailableCartItems()` requires the product to exist
- item status must be `active`
- requested quantity must be available
- checkout price must be greater than zero
- offer accept/counter checkout creation uses this same gate

Bridge labels returned by the engine:

- `ok`
- `missing_inventory_item`
- `sku_link_only`
- `quantity_mismatch`
- `price_mismatch`
- `sold_out`

eBay import now avoids global SKU upserts. The import updates by active-store eBay listing ID first, then by active-store SKU, then inserts only when no store-scoped product exists.

## eBay Reconciliation Operations

Admin screen:

```text
src/app/admin/ebay/page.tsx
```

This screen reads local TCOS data only. It does not call eBay on page load. It uses `products.sku`, `products.ebay_item_id`, `products.quantity`, `products.price`, and `products.last_seen_at` to show local sync readiness.

Current local eBay labels:

- `ok`
- `missing_sku`
- `not_linked`
- `never_synced`
- `stale_sync`
- `sold_out`

Current stale-sync threshold:

```text
12 hours
```

The eBay page links to the existing protected routes:

- `/api/ebay/test`
- `/api/ebay/import-listings?offset=0&limit=50`
- `/api/ebay/full-sync`
- `/api/ebay/auth`

Shared eBay sync service:

```text
src/lib/ebay-sync.ts
```

Both `/api/ebay/import-listings` and `/api/ebay/full-sync` use this service. Full sync calls the importer directly instead of calling the protected import route through HTTP, so it does not require admin cookies or a correct public site URL to continue batch syncing.

Store-level eBay sync toggle:

```text
store_settings.metadata.ebay_sync_enabled
```

Resolved through:

```text
src/lib/store-settings.ts
```

Default value:

```text
true
```

Admin screen:

```text
src/app/admin/settings/page.tsx
```

When the toggle is false, TCOS blocks or skips:

- `/api/ebay/import-listings`
- `/api/ebay/full-sync`
- `/api/ebay/auth`
- `/api/ebay/callback`
- post-sale `syncEbayQuantityAfterSale()`

### `sales_comp_snapshots`

Stores pricing comp history.

Created by migration:

```text
supabase/migrations/20260627160000_create_sales_comp_snapshots.sql
```

Fields:

| Field | Purpose |
| --- | --- |
| `id` | Snapshot ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `legacy_product_id` | Product ID |
| `query` | Search query used |
| `suggested_price` | TCOS suggested price |
| `suggested_price_method` | Method explanation |
| `average_price` | Average comp price |
| `median_price` | Median comp price |
| `low_price` | Lowest comp |
| `high_price` | Highest comp |
| `comp_count` | Total comps found |
| `recent_comp_count` | Recent comps used |
| `source_status` | eBay status |
| `source_message` | eBay message |
| `google_status` | Google status |
| `google_message` | Google message |
| `price_guide_status` | Price guide status |
| `price_guide_message` | Price guide message |
| `comps` | Raw comp JSON |
| `google_results` | Google result JSON |
| `research_links` | Research link JSON |
| `created_at` | Snapshot timestamp |

### `tos_acceptance_events`

Stores TOS acceptance evidence for chargeback, fraud, and account-security review.

Created by migration:

```text
supabase/migrations/20260627173000_add_tos_identity_evidence.sql
```

Fields:

| Field | Purpose |
| --- | --- |
| `id` | Audit event ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `context_type` | Flow, such as checkout or offer |
| `context_id` | Optional related record ID |
| `tos_kind` | Buyer or seller TOS |
| `tos_version` | Accepted TOS version |
| `ip_address` | Server-observed public client IP |
| `user_agent` | Browser user agent |
| `ip_risk` | verified, unchecked, or blocked |
| `ip_block_reason` | Provider or validation block reason |
| `ip_evidence` | Request header evidence JSON |
| `created_at` | Acceptance timestamp |

### `transaction_evidence_reports`

Stores transaction evidence packets for chargeback defense, fraud review, and legal dispute support.

Created by migration:

```text
supabase/migrations/20260627180000_create_transaction_evidence_reports.sql
```

Fields:

| Field | Purpose |
| --- | --- |
| `id` | Evidence report ID |
| `store_id` | TCOS store ID, defaults to Store #1 |
| `order_id` | Related order ID |
| `stripe_session_id` | Stripe checkout session ID |
| `stripe_event_id` | Stripe webhook event ID |
| `customer_email` | Customer email snapshot |
| `total` | Order total snapshot |
| `status` | Report status |
| `report_json` | Structured report data |
| `report_text` | Plain text evidence packet |
| `report_html` | HTML evidence packet |
| `emailed_to` | Evidence email recipient |
| `email_sent_at` | Evidence email sent timestamp |
| `email_error` | Evidence email failure detail |
| `created_at` | Report creation timestamp |
| `updated_at` | Report update timestamp |

## Current Migrations

### `20260628110000_create_tcos_stores.sql`

Creates:

- `stores`
- Store #1 = Truely Collectables
- `store_id` columns/defaults on current core tables
- store indexes for future multi-store filtering

### `20260628113000_create_store_settings.sql`

Creates:

- `store_settings`
- Store #1 operational email/settings defaults
- eBay environment/account label
- seller commission rate foundation

### `20260628114000_create_inventory_tables.sql`

Creates:

- `inventory_items`
- `inventory_images`
- `inventory_attributes`
- indexes for SKU, status, image ordering, and attributes

### `20260627160000_create_sales_comp_snapshots.sql`

Creates:

- `sales_comp_snapshots`
- index on `(legacy_product_id, created_at desc)`

### `20260627170000_add_tos_acceptance_to_orders_offers.sql`

Creates TOS acceptance columns on:

- `orders`
- `offers`

### `20260627173000_add_tos_identity_evidence.sql`

Creates:

- `tos_acceptance_events`
- TOS IP evidence columns on `orders`
- TOS IP evidence columns on `offers`
- indexes for IP and context lookup

### `20260627180000_create_transaction_evidence_reports.sql`

Creates:

- `transaction_evidence_reports`
- unique index through `stripe_session_id`
- indexes for order and report date lookup

## Operational SQL

### Clear fake orders

```sql
truncate table order_items, orders restart identity cascade;
```

This does not touch inventory or eBay.

## Safety Notes

- Clearing `orders` and `order_items` does not restore inventory quantity.
- eBay sync can restore local stock from active eBay listings.
- Product deletion is not implemented. Use `archived` or `sold`.
- `products.quantity` and `inventory_items.quantity` should stay synchronized through `inventoryEngine`.
