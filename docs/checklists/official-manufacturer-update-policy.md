# Official Manufacturer Checklist Update Policy

## Rule

All ongoing new-release checklist updates must come from the manufacturer or the manufacturer's official card database, checklist page, product page, or official asset host.

Public aggregators may remain in the historical/backfill archive as source-attributed evidence, but they are not permitted to create or replace a live Checklist Registry version through the automatic updater.

## One Registry

Sports, Pokemon, entertainment, non-sport, stickers, Magic: The Gathering, Yu-Gi-Oh, Lorcana, and future card universes are stored in the same versioned `checklist_*` Registry. `universe` classifies the release; it does not create a separate database.

## Update sequence

1. Crawl only configured official manufacturer hosts.
2. Record newly discovered official source URLs in `checklist_source_catalog`.
3. Download the source and verify the final redirect remains on an allowlisted official host.
4. Hash the source bytes and skip an unchanged imported source.
5. Preserve the original official file privately.
6. Parse through the registered manufacturer adapter.
7. Validate release identity, sets, cards, parallels, and physical-printing identities.
8. Import only a clean supported artifact through `importChecklistArtifact`.
9. Quarantine unsupported formats, missing adapters, contradictions, suspicious card-count reductions, and validation failures without changing the current live Registry version.
10. Retain receipts for discovered, unchanged, imported, quarantined, and failed sources.

## Manufacturer coverage

The initial policy covers Topps, Panini, Upper Deck, Leaf, The Pokemon Company, Konami Yu-Gi-Oh, Wizards of the Coast, and Ravensburger Disney Lorcana. Adding another manufacturer requires an explicit official-host allowlist and a deterministic source adapter before automatic live imports are allowed.

## Safety boundary

A newly found source is not automatically trusted merely because its title resembles a checklist. The updater requires an official host, a stable source hash, a registered adapter, and a clean Registry validation plan. Unsupported official sources are retained in the queue for adapter work; they are never guessed into the live database.
