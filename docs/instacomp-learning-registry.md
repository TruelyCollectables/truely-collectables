# InstaComp Learning and Checklist Registry

## What every scan means

A successful InstaComp scan is an observation, not a claim that Truely Collectables owns the card. Cards may be scanned from inventory, at a show, during an evaluation, or while reviewing a possible purchase.

The permanent learning ledger records the identified card, evidence, market snapshot, image hashes when available, corrections, and source coverage. Historical scan rows are backfilled into the same ledger.

## Trust rules

Unreviewed scanner observations remain `learning`. Repeating the same AI guess does not make it trusted.

An exact identity becomes trusted after either:

- three owner/operator confirmations; or
- one exact official Checklist Registry confirmation.

The owner can also mark a scan wrong or requiring more information. Those states prevent silent promotion.

## Speed path

Direct scans use a learning-first gateway:

1. Hash the front and optional back image.
2. Reuse an exact trusted image result when its market snapshot is still within the six-hour freshness window.
3. Otherwise run the primary scanner.
4. Check the private Checklist Registry before secondary AI readers.
5. Skip secondary readers only when an exact Registry identity is confirmed.
6. Refresh live market evidence independently of permanent card identity.

Cache replay adds an observation but never increases the confirmed count.

## Checklist Registry

Original manufacturer or approved checklist files are archived privately. The Registry stores normalized factual data separately from the source archive and gives every physical card identity a deterministic SHA-256 fingerprint.

Different base cards, inserts, parallels, autographs, memorabilia cards, variations, configuration exclusives, and serial-number runs must never collapse into the same identity.

The first importer accepts the Panini structured JSON contract. The source-adapter interface allows additional manufacturer formats without replacing the Registry identity system.

## Import safety

Checklist imports follow this sequence:

1. Select an approved adapter.
2. Parse and validate the source without writing.
3. Show release details, row totals, identities, and validation notices.
4. Archive the original source privately with SHA-256 deduplication.
5. Write the normalized release, version, sets, cards, players, teams, parallels, and identities in one database transaction.
6. Route questionable rows to validation instead of inventing values.
7. Treat a repeated source hash and parser version as an idempotent replay.

No original checklist source receives a public URL, and normalized facts remain internal to InstaComp.

## Verification contract

The PostgreSQL integration gate proves:

- a first scan remains learning;
- partial operator corrections preserve the rest of the detected identity;
- three operator confirmations promote trust;
- one exact catalog confirmation promotes trust;
- cache replay does not inflate confirmation trust;
- historical learning backfill is idempotent;
- Registry import row counts match the validated plan; and
- importing the same Registry source twice does not duplicate cards or identities.
