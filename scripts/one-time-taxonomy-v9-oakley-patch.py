from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1))


taxonomy = Path("src/lib/storefront-taxonomy.ts")
replace_once(
    taxonomy,
    "export const STOREFRONT_TAXONOMY_VERSION = 8;",
    "export const STOREFRONT_TAXONOMY_VERSION = 9;",
    "taxonomy version",
)
replace_once(
    taxonomy,
    '''  const storedSection = trustworthyStoredSection(params.metadata);
  if (storedSection) return storedSection;

  const context = cardContext(params);''',
    '''  const storedSection = trustworthyStoredSection(params.metadata);
  if (storedSection) return storedSection;

  const titleOnly = normalized(params.title);
  const explicitAccessoryObject =
    /\\b(?:wristwatch|sunglasses|eyewear|oakley)\\b/.test(titleOnly) ||
    (/\\bwatch\\b/.test(titleOnly) && !/\\bfuture watch\\b/.test(titleOnly));
  if (explicitAccessoryObject) return "Watches & Accessories";

  const context = cardContext(params);''',
    "accessory object override",
)

sync = Path("src/lib/ebay-authoritative-store-sync.ts")
replace_once(
    sync,
    "const STOREFRONT_TAXONOMY_VERSION = 8;",
    "const STOREFRONT_TAXONOMY_VERSION = 9;",
    "authoritative taxonomy version",
)

mapper = Path("src/lib/ebay-category-mapper.ts")
replace_once(
    mapper,
    '''}): EbayCategoryMapping {
  const aspects = input.aspects ?? {};
  const focusedSearchable =''',
    '''}): EbayCategoryMapping {
  const aspects = input.aspects ?? {};
  const titleText = input.title.toLowerCase();
  const explicitAccessoryObject =
    /\\b(?:wristwatch|sunglasses|eyewear|oakley)\\b/.test(titleText) ||
    (/\\bwatch\\b/.test(titleText) && !/\\bfuture watch\\b/.test(titleText));

  if (explicitAccessoryObject) {
    const category = "other_collectable";
    const mappingConfidence = "high" as const;
    const evidence = ["physical accessory title"];

    return {
      category,
      confidence: mappingConfidence,
      reviewRequired: false,
      evidence,
      attributes: {
        tcos_category: category,
        tcos_category_confidence: mappingConfidence,
        tcos_review_required: "false",
        tcos_category_evidence: evidence.join(", "),
        tcos_is_autograph: String(
          hasStrongAutographEvidence(input.title, aspects),
        ),
        ...usefulAspectAttributes(aspects),
      },
    };
  }

  const focusedSearchable =''',
    "mapper accessory override",
)

tests = Path("scripts/run-storefront-taxonomy-regressions.ts")
test_text = tests.read_text()
if "const oakleyProductionOverride" in test_text:
    raise SystemExit("taxonomy v9 tests already exist")
test_text += r'''

const oakleyProductionOverride = classifyStorefrontItem({
  title:
    "Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130",
  primaryCategory: "sports_cards",
  metadata: {
    tcos_storefront_section: "Needs Review",
    tcos_taxonomy_version: 8,
  },
});
assert.equal(oakleyProductionOverride.section, "Watches & Accessories");
assert.equal(oakleyProductionOverride.features.autograph, false);
assert.equal(oakleyProductionOverride.features.memorabilia, false);
assert.equal(oakleyProductionOverride.features.graded, false);
assert.equal(oakleyProductionOverride.features.rookie, false);

const oakleyMapperOverride = mapEbayInventoryCategory({
  title:
    "Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130",
});
assert.equal(oakleyMapperOverride.category, "other_collectable");
assert.equal(oakleyMapperOverride.confidence, "high");
assert.equal(oakleyMapperOverride.reviewRequired, false);

const futureWatchCardV9 = classifyStorefrontItem({
  title:
    "2024-25 SP Authentic Danil Gushchin Retro Autographed Future Watch /699",
  primaryCategory: "sports_cards",
  metadata: { tcos_taxonomy_version: 8 },
});
assert.equal(futureWatchCardV9.section, "Hockey");
assert.equal(futureWatchCardV9.features.autograph, true);
assert.equal(futureWatchCardV9.features.numbered, true);
'''
tests.write_text(test_text)

Path(__file__).unlink()
