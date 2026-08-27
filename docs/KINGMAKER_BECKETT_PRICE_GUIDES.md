# KINGMAKER Beckett Price-Guide Ingestion

KINGMAKER treats a printed Beckett value as a dated reference observation, not as the live market price and not as a replacement for sold comps.

## Security and source handling

- Original PDFs, OCR text, page layouts, and normalized rows are private and service-role-only.
- No Beckett PDF or extracted dataset belongs in the public Git repository.
- Original files and extraction bundles may be archived only in the private `tcos-kingmaker-price-guide-sources` Supabase Storage bucket.
- The database tables have RLS enabled and grant no access to `anon` or `authenticated`.
- `redistribution_allowed` is always false for this source class.

## Database flow

1. `tcos_kingmaker_price_guides` records the edition, SHA-256, page range, parser version, and private storage receipts.
2. `tcos_kingmaker_price_import_runs` records each validation or import attempt.
3. `tcos_kingmaker_price_pages` preserves page-level OCR and layout evidence.
4. `tcos_kingmaker_price_entries` contains parsed rows and their review state.
5. `tcos_kingmaker_price_review_queue` keeps uncertain values and identity conflicts out of live pricing.
6. `tcos_match_kingmaker_price_entries(uuid)` exact-matches card rows against the active Checklist Registry version.
7. `tcos_promote_kingmaker_price_entries(uuid)` creates immutable `book_value_low` and `book_value_high` observations in `tcos_kingmaker_observations` only for accepted rows.

## Acceptance policy

The importer fails closed.

- Embedded-text rows can be accepted automatically only after an exact active Checklist Registry identity match and parser confidence of at least `0.98`.
- OCR-derived rows remain in review even when the card identity matches exactly. The printed values must be visually verified before promotion.
- Ambiguous identities, unmatched cards, aggregate values, wrappers, complete sets, multipliers, and malformed low/high ranges remain in review.
- A missing card in a monthly guide must never be interpreted as proof that the card does not exist. Beckett is a pricing-reference source; the Checklist Registry remains the identity source of truth.

## Bundle format

The extractor produces a private ZIP containing:

- `manifest.json`
- `pages.ndjson`
- `entries.ndjson`

The schema is `tcos.kingmaker.beckettPriceGuideBundle.v1`. Every entry has a deterministic source-row key derived from the source PDF SHA-256, page number, row order, and raw row text.

## Extract a guide

Dependencies:

```bash
python -m pip install pymupdf pillow
tesseract --version
```

Text-layer example:

```bash
python scripts/extract-kingmaker-beckett-price-guides.py \
  --pdf "/private/Beckett Basketball 08.2026.pdf" \
  --title "Beckett Basketball August 2026" \
  --sport Basketball \
  --issue-code 2026-08 \
  --edition-date 2026-08-01 \
  --start-page 27 \
  --end-page 169 \
  --columns 7 \
  --mode text \
  --output "/private/kingmaker-beckett/basketball-2026-08"
```

Image-only example:

```bash
python scripts/extract-kingmaker-beckett-price-guides.py \
  --pdf "/private/Beckett Hockey 08.2026.pdf" \
  --title "Beckett Hockey August 2026" \
  --sport Hockey \
  --issue-code 2026-08 \
  --edition-date 2026-08-01 \
  --start-page 34 \
  --end-page 174 \
  --columns 7 \
  --mode ocr \
  --scale 3 \
  --workers 2 \
  --output "/private/kingmaker-beckett/hockey-2026-08"
```

Use conservative worker counts for large scanned magazines. Two OCR workers are the safe default on ordinary developer machines.

## Validate before touching Production

```bash
npx tsx scripts/run-kingmaker-beckett-price-guide-import.ts \
  --bundle "/private/kingmaker-beckett/hockey-2026-08"
```

This validates all hashes, page references, counts, entry schemas, and low/high ranges without writing to Supabase.

## Stage in Production

Run only in a protected environment containing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`:

```bash
npx tsx scripts/run-kingmaker-beckett-price-guide-import.ts \
  --bundle "/private/kingmaker-beckett/hockey-2026-08" \
  --archive-bundle "/private/kingmaker-beckett/hockey-2026-08.zip" \
  --archive-pdf "/private/Beckett Hockey 08.2026.pdf" \
  --apply
```

`--apply` stages the data, performs Registry matching, and creates review work. It does not promote review rows.

## Promote verified rows

Promotion is intentionally separate:

```bash
npx tsx scripts/run-kingmaker-beckett-price-guide-import.ts \
  --bundle "/private/kingmaker-beckett/basketball-2026-08" \
  --apply \
  --promote
```

Before using `--promote`, review the generated queue and confirm that only correct identities and printed values are marked `accepted`.

## Current guide ranges

| Guide | Price-guide PDF pages | Extraction mode | Columns |
|---|---:|---|---:|
| Baseball, September 2026 | 41–234 | OCR | 7 |
| Football, September 2026 | 27–169 | OCR | 7 |
| Basketball, August 2026 | 27–169 | Text layer | 7 |
| Hockey, August 2026 | 34–174 | OCR | 7 |
| Vintage Collector, Aug./Sept. 2026 | 92–112 | OCR | 5 |

These ranges are part of the ingestion receipt and must be rechecked for every new edition.
