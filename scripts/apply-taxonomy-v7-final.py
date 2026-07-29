from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1))


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text()
    updated, count = re.subn(
        pattern,
        lambda _: replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(updated)


# Universal inventory feature contract.
types_path = Path("src/modules/inventory/types.ts")
regex_once(
    types_path,
    r"export type StorefrontFeatureFlags = \{\s*autograph: boolean;\s*rookie: boolean;\s*graded: boolean;\s*numbered: boolean;\s*\};",
    """export type StorefrontFeatureFlags = {
  autograph: boolean;
  memorabilia: boolean;
  rookie: boolean;
  graded: boolean;
  numbered: boolean;
};""",
    "inventory feature flags",
)

# Public storefront navigation and visible card tags.
shop_path = Path("src/app/shop/page.tsx")
regex_once(
    shop_path,
    r'import \{\s*sortStorefrontSections,\s*type StorefrontSort,\s*\} from "\.\./\.\./lib/storefront-taxonomy";',
    '''import {
  COLLECTIBLE_SECTIONS,
  SPORT_SECTIONS,
  sortStorefrontSections,
  type StorefrontSort,
} from "../../lib/storefront-taxonomy";''',
    "shop taxonomy imports",
)
regex_once(
    shop_path,
    r"const QUICK_SECTIONS = \[[\s\S]*?\];\n",
    '''const FEATURE_LINKS = [
  { key: "autograph", label: "Autographs" },
  { key: "memorabilia", label: "Memorabilia Cards" },
  { key: "graded", label: "Graded Cards" },
  { key: "rookie", label: "Rookie Cards" },
  { key: "numbered", label: "Numbered Cards" },
] as const;
''',
    "shop feature links",
)
replace_once(
    shop_path,
    '  if (params.feature === "autograph") return "Autographed Items";',
    '''  if (params.feature === "autograph") return "Autographed Items";
  if (params.feature === "memorabilia") return "Memorabilia Cards";''',
    "memorabilia heading",
)
regex_once(
    shop_path,
    r"  const badges = \[[\s\S]*?\]\.filter\(Boolean\) as string\[\];",
    '''  const badges = [
    product.features.autograph ? "Autograph" : null,
    product.features.memorabilia ? "Memorabilia Card" : null,
    product.features.graded ? "Graded Card" : null,
    product.features.rookie ? "Rookie Card" : null,
    product.features.numbered ? "Numbered" : null,
  ].filter(Boolean) as string[];''',
    "feature badge labels",
)
regex_once(
    shop_path,
    r'  const activeFilters = Boolean\(q \|\| section \|\| feature \|\| sort !== "section"\);[\s\S]*?  \]\);\n\n  return \(',
    '''  const activeFilters = Boolean(q || section || feature || sort !== "section");
  const sectionOptions = sortStorefrontSections([
    ...SPORT_SECTIONS,
    ...COLLECTIBLE_SECTIONS,
    ...sections,
  ]);

  return (''',
    "section option sources",
)
navigation = '''      <section className="mb-8 space-y-5">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Shop by sport
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Shop by sport">
            <Link
              href="/shop"
              className="rounded-full border-2 border-neutral-950 bg-white px-4 py-2 text-sm font-black hover:bg-yellow-300"
            >
              All Inventory
            </Link>
            {SPORT_SECTIONS.map((name) => (
              <Link
                key={name}
                href={shopHref({ section: name })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Collectible types
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Collectible types">
            {COLLECTIBLE_SECTIONS.map((name) => (
              <Link
                key={name}
                href={shopHref({ section: name })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Card features
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Card features">
            {FEATURE_LINKS.map((item) => (
              <Link
                key={item.key}
                href={shopHref({ feature: item.key })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${feature === item.key ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <form'''
regex_once(
    shop_path,
    r"      <nav[\s\S]*?      </nav>\n\n      <form",
    navigation,
    "sport and feature navigation",
)
regex_once(
    shop_path,
    r'<option value="autograph">Autographs</option>\s*<option value="rookie">Rookies</option>\s*<option value="graded">Graded</option>\s*<option value="numbered">Numbered</option>',
    '''<option value="autograph">Autographs</option>
          <option value="memorabilia">Memorabilia Cards</option>
          <option value="graded">Graded Cards</option>
          <option value="rookie">Rookie Cards</option>
          <option value="numbered">Numbered Cards</option>''',
    "feature select options",
)

# Public catalog must not expose unresolved or deprecated fallback buckets.
launch_path = Path("src/lib/sports-card-launch-scope.ts")
regex_once(
    launch_path,
    r"const ALLOWED_SECTIONS = new Set\(\[[\s\S]*?\]\);",
    '''const ALLOWED_SECTIONS = new Set([
  "Baseball",
  "NBA",
  "WNBA",
  "Basketball",
  "Football",
  "Hockey",
  "Soccer",
  "Wrestling",
  "MMA / UFC",
  "Boxing",
  "Golf",
  "Tennis",
  "Racing / NASCAR",
  "Cricket",
  "Lacrosse",
  "Volleyball",
  "Rugby",
  "Olympics / Track & Field",
  "Poker",
  "Skateboarding",
  "Multi-Sport",
  "Sealed Wax",
  "Pucks",
  "Balls",
  "Jerseys",
  "Helmets",
  "Bats & Gloves",
  "Photos & Prints",
  "Tickets & Programs",
  "Pins & Souvenirs",
  "Signs & Display",
  "Music",
  "Trading Card Games",
  "Entertainment & Pop Culture",
  "Comics",
  "Coins",
  "Toys & Figures",
  "Watches & Accessories",
]);''',
    "explicit launch sections",
)
replace_once(
    launch_path,
    "  if (!title || PARTS_PATTERN.test(searchable)) return false;",
    '''  if (
    !title ||
    section === "Needs Review" ||
    [
      "Other Sports",
      "Other Collectables",
      "Other Collectibles",
      "Memorabilia",
      "Autographs",
    ].includes(section) ||
    PARTS_PATTERN.test(searchable)
  ) {
    return false;
  }''',
    "review and deprecated section exclusion",
)
regex_once(
    launch_path,
    r"  if \(ALLOWED_CATEGORIES\.has\(category\)\) return true;\s*  if \(ALLOWED_SECTIONS\.has\(section\)\) return true;[\s\S]*?  return true;",
    '''  if (ALLOWED_SECTIONS.has(section)) return true;
  if (ALLOWED_CATEGORIES.has(category) && section !== "Needs Review") return true;
  return false;''',
    "explicit launch allowlist",
)

# Force every active listing through taxonomy v7 on the next authoritative sync.
sync_path = Path("src/lib/ebay-authoritative-store-sync.ts")
replace_once(
    sync_path,
    "const STOREFRONT_TAXONOMY_VERSION = 6;",
    "const STOREFRONT_TAXONOMY_VERSION = 7;",
    "authoritative taxonomy version",
)

# Recognize eBay shorthand such as /12 as numbered.
taxonomy_path = Path("src/lib/storefront-taxonomy.ts")
taxonomy_text = taxonomy_path.read_text()
old_fragment = "|serial numbered|"
new_fragment = "|(?:^|\\s)\\/\\d{1,5}\\b|serial numbered|"
if taxonomy_text.count(old_fragment) != 1:
    raise SystemExit(
        f"numbered shorthand fragment: expected one match, found {taxonomy_text.count(old_fragment)}"
    )
taxonomy_path.write_text(taxonomy_text.replace(old_fragment, new_fragment, 1))

# Permanent regression coverage using exact live problem titles.
tests_path = Path("scripts/run-storefront-taxonomy-regressions.ts")
tests_text = tests_path.read_text()
replace_once(
    tests_path,
    '''  classifyStorefrontItem,
  matchesStorefrontFilters,
  sortStorefrontItems,''',
    '''  classifyStorefrontItem,
  matchesStorefrontFilters,
  sortStorefrontItems,
  sortStorefrontSections,''',
    "taxonomy test imports",
)
tests_text = tests_path.read_text()
old_watch_tests = '''assert.equal(
  isLaunchCollectible({ title: "Oakley Sports Sunglasses Black", sport: null }),
  true,
);
assert.equal(
  isLaunchCollectible({ title: "Collectible Wristwatch", sport: null }),
  true,
);'''
new_watch_tests = '''assert.equal(
  isLaunchCollectible({
    title: "Oakley Sports Sunglasses Black",
    sport: "Watches & Accessories",
    storefrontSection: "Watches & Accessories",
  }),
  true,
);
assert.equal(
  isLaunchCollectible({
    title: "Collectible Wristwatch",
    sport: "Watches & Accessories",
    storefrontSection: "Watches & Accessories",
  }),
  true,
);'''
if tests_text.count(old_watch_tests) != 1:
    raise SystemExit(
        f"legacy watch tests: expected one match, found {tests_text.count(old_watch_tests)}"
    )
tests_text = tests_text.replace(old_watch_tests, new_watch_tests, 1)
if "const taxonomyV7Cases =" in tests_text:
    raise SystemExit("taxonomy v7 tests already exist")
tests_text += r'''

const taxonomyV7Cases = [
  ["1993-94 Stadium Club #17 Nick Van Exel Beam Team Members Only", "NBA"],
  ["1997-98 Leaf #6 Paul Kariya Fractal Matrix Die Cuts SSP", "Hockey"],
  ["2001 SP Authentic #31 Peter Jacobsen Gold #/500", "Golf"],
  ["2006 Razor WPT Showdown Signatures Hoyt Corkins WSOP Royalty SSP Auto", "Poker"],
  ["2013 Leaf Keeping It Real Autos Bam Margera RC SP /25", "Skateboarding"],
  ["2025 Score #35 Jaxson Dart Red", "Football"],
  ["2025 Topps Chrome Update John Rave RC Auto Orange Refractors /25", "Baseball"],
  ["2025-26 SkyBox Metal Universe #150 Ivan Demidov", "Hockey"],
  ["2026 Donruss #1 Paige Bueckers Donruss Ballpark Stars RC", "WNBA"],
  ["ME05: Pitch Black #077/084 Gladion's Final Battle", "Trading Card Games"],
  ["Prize Pack Series Cards #005 Basic Psychic Energy", "Trading Card Games"],
  ["Saturn Automotive GM Dealer Quartz Wristwatch Water Resistant Japan Movement NEW", "Watches & Accessories"],
  ["NOAH HANIFIN Limited Edition 2024 Preseason Pin Vegas Golden Knights SGA NEW", "Pins & Souvenirs"],
  ["Vegas Golden Knights vanity license plate for player Alex Tuch TUCH", "Signs & Display"],
  ["The Beastie Boys ALL 3 Signed CD Booklet PSA Authenticated", "Music"],
  ["2024 POP CENTURY RETRO TV AUTO ED MARINARO 1/1 AUTOGRAPH HILL STREET BLUES", "Entertainment & Pop Culture"],
] as const;

for (const [title, expectedSection] of taxonomyV7Cases) {
  const result = classifyStorefrontItem({
    title,
    primaryCategory: "other_collectable",
  });
  assert.equal(result.section, expectedSection, title);
  assert.ok(
    !["Other Collectables", "Other Sports", "Memorabilia"].includes(
      result.section,
    ),
  );
}

const baseballJerseyCard = classifyStorefrontItem({
  title: "2004 SkyBox LE #20 Josh Beckett PINSTRIPE Jersey Proof /299",
  rawSport: "Baseball",
  primaryCategory: "memorabilia",
});
assert.equal(baseballJerseyCard.section, "Baseball");
assert.equal(baseballJerseyCard.features.memorabilia, true);

const hockeyRelicCard = classifyStorefrontItem({
  title: "2017-18 SP Game Used #FW-JQ Jonathan Quick Frameworks Jumbo Jersey Relic",
  rawSport: "Ice Hockey",
  primaryCategory: "memorabilia",
});
assert.equal(hockeyRelicCard.section, "Hockey");
assert.equal(hockeyRelicCard.features.memorabilia, true);

const gradedBaseball = classifyStorefrontItem({
  title: "1989 Upper Deck #13 Gary Sheffield RC PSA 10",
  primaryCategory: "sports_cards",
});
assert.equal(gradedBaseball.section, "Baseball");
assert.equal(gradedBaseball.features.graded, true);
assert.equal(gradedBaseball.features.rookie, true);

const multiFeatureCard = classifyStorefrontItem({
  title: "2025 Panini Origins Shedeur Sanders RC Jumbo Patch Auto Pink RPA FOTL /12 PSA 9",
  primaryCategory: "sports_cards",
});
assert.equal(multiFeatureCard.section, "Football");
assert.equal(multiFeatureCard.features.autograph, true);
assert.equal(multiFeatureCard.features.memorabilia, true);
assert.equal(multiFeatureCard.features.graded, true);
assert.equal(multiFeatureCard.features.rookie, true);
assert.equal(multiFeatureCard.features.numbered, true);
assert.equal(
  matchesStorefrontFilters(baseballJerseyCard, {
    feature: "memorabilia cards",
  }),
  true,
);
assert.deepEqual(
  sortStorefrontSections([
    "Other Sports",
    "Baseball",
    "Memorabilia",
    "Other Collectables",
    "Hockey",
    "Needs Review",
  ]),
  ["Baseball", "Hockey"],
);
'''
tests_path.write_text(tests_text)

# Update source-level storefront regressions to the centralized v7 structure.
simulation_path = Path("scripts/run-ebay-import-admin-client-simulations.ts")
simulation_text = simulation_path.read_text()
old_simulation_block = '''assert.match(shopPageSource, /"NBA",[\s\S]*"WNBA",[\s\S]*"Basketball"/);
assert.ok(!shopPageSource.includes('product.category?.replaceAll("_", " ")'));
assert.ok(shopPageSource.includes("View Item"));
assert.match(shopPageSource, /const quickSections = QUICK_SECTIONS;/);
assert.match(shopPageSource, /const sectionOptions = sortStorefrontSections/);'''
new_simulation_block = '''assert.match(
  shopPageSource,
  /SPORT_SECTIONS[\s\S]*COLLECTIBLE_SECTIONS[\s\S]*sortStorefrontSections/,
  "The shop must use centralized sport and collectible section lists.",
);
assert.match(
  shopPageSource,
  /FEATURE_LINKS[\s\S]*Memorabilia Cards[\s\S]*Graded Cards/,
  "Card feature navigation must expose memorabilia and graded-card filters.",
);
assert.match(
  shopPageSource,
  /product\.features\.memorabilia \? "Memorabilia Card"/,
  "Product tiles must label memorabilia cards.",
);
assert.ok(!shopPageSource.includes('product.category?.replaceAll("_", " ")'));
assert.ok(shopPageSource.includes("View Item"));'''
if simulation_text.count(old_simulation_block) != 1:
    raise SystemExit(
        f"storefront simulation block: expected one match, found {simulation_text.count(old_simulation_block)}"
    )
simulation_path.write_text(
    simulation_text.replace(old_simulation_block, new_simulation_block, 1)
)

# Leave only production code and permanent tests in the PR.
for workflow in Path(".github/workflows").glob(
    "one-time-storefront-taxonomy-v7-no-junk-buckets*.yml"
):
    workflow.unlink()
diagnostic_workflow = Path(
    ".github/workflows/diagnose-storefront-taxonomy-v7-features-20260728.yml"
)
if diagnostic_workflow.exists():
    diagnostic_workflow.unlink()

Path(__file__).unlink()
