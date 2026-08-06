# TCOS Checklist Registry — Phase 1 Mainstream 2000+ Scope

## Objective

Build and audit one universal card checklist database from 2000 through the current year before expanding into vintage, regional, promotional, food, convention, test, proof, mail-in, and other one-off issues.

## Included universes in the same database

- Baseball, basketball, football, hockey, soccer
- Racing, wrestling, MMA/UFC/PFL, boxing, golf, tennis
- Multi-sport products
- Pokemon
- Licensed entertainment and non-sport trading cards
- Magic: The Gathering, Yu-Gi-Oh!, Disney Lorcana, and other major TCG products
- Mainstream sticker products

## Pokemon placement and source

- Pokemon is a first-class universe in the same master database as every other card category.
- Pokemon is classified as `universe=pokemon` and `sport=null`; it is not filed under sports cards.
- Existing Pokemon data is exported from InstaComp AI's live Checklist Registry tables and merged into the same exact-key master output.
- InstaComp AI is the Pokemon source system, not a separate final database.
- Public Pokemon records may corroborate, correct, or add missing releases, but they must reconcile against InstaComp's existing identities rather than overwrite them blindly.
- No card images are copied by this checklist merge.

## Mainstream release rule

A Phase 1 release is a nationally or broadly distributed, cataloged product issued from 2000 through the current year by an established manufacturer or printed brand. Hobby, retail, update, traded, insert, parallel, autograph, memorabilia, mainstream TCG, entertainment, and mainstream regional-language counterparts may be included when the source identifies them as part of the regular product structure.

## Deferred until Phase 2

- Vintage issues before 2000
- Team-issued, local, regional, and minor promotional issues
- Food, restaurant, cereal, and mail-in releases
- Convention exclusives and silver-pack programs
- Samples, proofs, test issues, prototypes, and replacement issues
- Postcards, stamps, coins, discs, wrappers, packs, boxes, and uncut sheets
- Other oddballs and one-off issues

Deferred records are retained and labeled. They are not deleted or silently merged into mainstream products.

## Readiness standard

A set identity alone is not checklist-complete. Phase 1 reporting distinguishes:

1. Set identity only
2. Checklist rows present from one source
3. Checklist rows present with multiple-source corroboration
4. Unresolved classification or conflicting evidence

A release is not marked checklist-ready unless at least one source supplies actual checklist rows. Manufacturer-issued files and exact published tables have priority over secondary editorial summaries.

## Required outputs

- One universal 2000+ exact-set catalog containing sports, Pokemon, entertainment, non-sport, stickers, and other TCGs
- Coverage by year and universe
- Set identities lacking checklist rows
- Multi-source corroboration counts
- Pokemon convenience view sourced from the same master rows, not a separate database
- Deferred Phase 2 catalog
- Unresolved records and source failure receipts

## Completion rule

TCOS must not claim Phase 1 complete merely because every year has some records. Completion requires release-inventory reconciliation by year, universe, manufacturer or printed brand, and product family. The build must fail its completeness gate when InstaComp Pokemon records are not present in the same master database.
