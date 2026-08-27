# InstaComp Verified Asset Lifecycle

## Purpose

A verified InstaComp result must become a permanent collectible asset record, not disposable listing text.

The same physical card must remain traceable through:

1. scan intake
2. human verification
3. Pending Listings
4. live inventory
5. sale
6. post-sale market monitoring

This supports later analysis of whether Truely Collectables sold too early, at the right time, or too late.

## Required identity fields

Every collectible asset record must preserve:

- player / subject
- year
- manufacturer / brand
- product / set
- insert / subset
- card number
- parallel / variation
- printed card serial number and denominator
- team / organization
- rookie status
- autograph status and authentication statement
- memorabilia / patch status and disclosure
- grading company
- grade
- grading certification number
- grading certification lookup URL
- grading verification status
- grading verification timestamp
- grading verification response snapshot
- grader-hosted front image URL when available
- grader-hosted back image URL when available
- original InstaComp front scan storage path
- original InstaComp back scan storage path
- normalized image fingerprints / hashes
- human-verification status and timestamp
- verified knowledge entry ID

Printed card serial numbers and grading certification numbers are separate identifiers and must never overwrite each other.

## Core tables / entities

### collectible_assets

One durable identity record for a specific physical collectible.

Suggested fields:

- id uuid primary key
- identity_key text
- player text
- year text
- brand text
- set_name text
- insert_name text
- card_number text
- parallel text
- variation text
- card_serial_number text
- card_serial_numerator integer
- card_serial_denominator integer
- team text
- sport text
- is_rookie boolean
- is_auto boolean
- is_relic boolean
- grading_company text
- grade_value text
- grading_certification_number text
- grading_lookup_url text
- grader_verification_status text
- grader_verified_at timestamptz
- grader_response_snapshot jsonb
- grader_front_image_url text
- grader_back_image_url text
- front_storage_path text
- back_storage_path text
- front_sha256 text
- back_sha256 text
- front_visual_fingerprint jsonb
- back_visual_fingerprint jsonb
- knowledge_entry_id uuid
- human_verified boolean
- human_verified_at timestamptz
- created_at timestamptz
- updated_at timestamptz

Use a partial unique constraint for grading-company + certification-number when both are known.

### inventory_lots

Tracks ownership and economics independently from card identity.

Suggested fields:

- id uuid primary key
- collectible_asset_id uuid not null
- quantity integer default 1
- acquisition_date date
- acquisition_cost numeric
- acquisition_source text
- source_item_number text
- status text
- seller_id uuid
- created_at timestamptz
- updated_at timestamptz

### pending_listings

Must reference collectible_asset_id and inventory_lot_id instead of duplicating identity text as the only record.

Suggested fields:

- id uuid primary key
- collectible_asset_id uuid not null
- inventory_lot_id uuid not null
- title text
- description text
- price numeric
- quantity integer
- sku text
- status text default 'pending'
- front_storage_path text
- back_storage_path text
- created_from text default 'instacomp_verified'
- created_at timestamptz
- updated_at timestamptz

### asset_sale_events

Preserves the actual disposal event.

Suggested fields:

- id uuid primary key
- collectible_asset_id uuid not null
- inventory_lot_id uuid not null
- order_id uuid
- order_item_id uuid
- sold_at timestamptz
- sale_price numeric
- shipping_revenue numeric
- platform_fee numeric
- processor_fee numeric
- shipping_cost numeric
- net_proceeds numeric
- realized_profit numeric
- buyer_marketplace text
- created_at timestamptz

### asset_market_snapshots

Allows post-sale performance analysis.

Suggested fields:

- id uuid primary key
- collectible_asset_id uuid not null
- observed_at timestamptz
- market_value numeric
- sold_comp_median numeric
- sold_comp_low numeric
- sold_comp_high numeric
- source_count integer
- comp_snapshot jsonb
- asset_state text
- days_since_sale integer
- created_at timestamptz

Asset state values should include owned, listed, sold, and post_sale_watch.

## Grading verification

For PSA, use the direct cert URL already produced by `gradingLookupUrl`:

`https://www.psacard.com/cert/<CERT>/psa`

Verification should capture the grader's returned:

- year
- brand / title
- subject
- card number
- variety / pedigree when present
- grade
- population
- population higher
- estimate when present
- grader images when present

The returned identity must be compared field-by-field with InstaComp. Conflicts require review and must never silently overwrite human-verified data.

Support adapters for BGS, SGC, CGC and other graders as their public lookup capabilities permit.

## Exact duplicate and reappearance behavior

When a future scan is uploaded:

1. match grading company + certification number first
2. match exact front/back cryptographic hashes
3. match verified visual fingerprints
4. match printed serial number plus exact card identity
5. return the durable collectible_asset record immediately when confidence is deterministic

A matching cert number with visually different scans must be flagged as possible counterfeit, wrong slab, duplicate cert use, or scan mismatch.

## Batch 001 import

Import the six human-verified records from the July 2026 Batch 001 verified-reference export.

All six records were approved as fully correct with correct front/back pairings and no field corrections.

They must be inserted as:

- six collectible_assets
- six inventory_lots with quantity 1
- six pending_listings
- twelve stored original scans
- six verified knowledge references

Price and SKU may remain null until operator completion on Pending Listings.

## Admin UI requirements

Pending Listings must display:

- front and back scans
- identity fields
- printed serial number
- grading company
- grade
- grading certification number
- Verify Cert button
- verification status and timestamp
- grader-hosted scans when available
- acquisition cost
- price
- SKU
- publish action

Asset history must show:

- acquisition
- listing events and price changes
- sale
- realized profit
- post-sale value snapshots
- value difference since sale
- classification: sold too early / near optimal / sold too late

The timing classification must use documented thresholds and remain recalculable as new market snapshots arrive.

## Safety and trust rules

- Seller titles are never identity proof.
- Original front/back scans remain immutable evidence.
- Grader lookup data is external evidence, not a replacement for scan review.
- Human corrections are append-only audit events.
- Published listing identity must trace back to the asset and verification records.
- Never discard sold asset records or grading certification numbers.
