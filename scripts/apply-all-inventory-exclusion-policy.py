from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        print(f"Already applied: {label}")
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    file_path.write_text(text.replace(old, new, 1))
    print(f"Applied: {label}")


sync_path = "src/lib/ebay-authoritative-store-sync.ts"
replace_once(
    sync_path,
    '''  const collectibleObject =
    /\\b(pucks?|baseballs?|footballs?|basketballs?|soccer balls?|softballs?|golf balls?|bats?|baseball gloves?|helmets?|photos?|photographs?|prints?|posters?|tickets?|programs?|media guides?)\\b/.test(
      searchable,
    );
  const collectibleEvidence =
    /\\b(signed|autographed|authenticated|authentication|coa|jsa|beckett|psa dna|game used|game worn|game issued|player worn|memorabilia|collectible)\\b/.test(
      searchable,
    );
  const sportSignal =
    /\\b(baseball|basketball|football|hockey|soccer|golf|tennis|wrestling|racing|nascar|formula 1|f1|ufc|mma|wnba|nba|nfl|nhl|mlb|mls|ncaa)\\b/.test(
      searchable,
    );

  return collectibleObject && (collectibleEvidence || sportSignal);
''',
    '''  // Explicit catalog policy: every active fixed-price eBay item is eligible
  // unless it matched the hard exclusions above for parts, ordinary clothing,
  // footwear, or a non-collectible jersey.
  return true;
''',
    "authoritative default-allow policy",
)

admin_path = "scripts/run-ebay-import-admin-client-simulations.ts"
replace_once(
    admin_path,
    'import { isLaunchSportsCard } from "../src/lib/sports-card-launch-scope";',
    'import { isLaunchCollectible } from "../src/lib/sports-card-launch-scope";',
    "collectibles policy test import",
)
replace_once(
    admin_path,
    '''  /items\\.filter\\(isLaunchSportsCard\\)/,
  "Every public inventory feed must enforce the sports-card launch scope.",
''',
    '''  /items\\.filter\\(isLaunchCollectible\\)/,
  "Every public inventory feed must enforce the approved catalog exclusions.",
''',
    "public collectible feed assertion",
)
replace_once(
    admin_path,
    '''  /async getByLegacyProductId\\([\\s\\S]*return item && isLaunchSportsCard\\(item\\) \\? item : null;/,
  "Direct product URLs must return no product when launch scope rejects the item.",
''',
    '''  /async getByLegacyProductId\\([\\s\\S]*return item && isLaunchCollectible\\(item\\) \\? item : null;/,
  "Direct product URLs must return no product when catalog exclusions reject the item.",
''',
    "direct collectible detail assertion",
)
replace_once(
    admin_path,
    '''  /async getByLegacyProductIds\\([\\s\\S]*return items\\.filter\\(isLaunchSportsCard\\);/,
  "Bulk public product lookups must enforce the same launch scope.",
''',
    '''  /async getByLegacyProductIds\\([\\s\\S]*return items\\.filter\\(isLaunchCollectible\\);/,
  "Bulk public product lookups must enforce the same catalog exclusions.",
''',
    "bulk collectible lookup assertion",
)
replace_once(
    admin_path,
    '  "The public product-image endpoint must reuse the sports-card scope guard.",',
    '  "The public product-image endpoint must reuse the catalog exclusion guard.",',
    "collectible image endpoint assertion copy",
)

admin = Path(admin_path)
text = admin.read_text()
new_cases = '''const launchScopeCases = [
  {
    title: "2025-26 Upper Deck #702 Florian Xhekaj",
    sport: null,
    expected: true,
  },
  {
    title: "2023 Topps Max Meyer 1988 35th Chrome RC Auto /249 PSA 8",
    sport: null,
    expected: true,
  },
  {
    title: "Wailord ex 016/084 Double Rare Pokemon Pitch Black 2026 NM",
    sport: null,
    expected: true,
  },
  {
    title: "Prize Pack Series Cards #005 Basic Psychic Energy",
    sport: null,
    expected: true,
  },
  {
    title: "Upper Deck Authenticated Wayne Gretzky Signed Puck",
    sport: "Pucks",
    expected: true,
  },
  {
    title: "Connor McDavid Autographed Edmonton Oilers Jersey",
    sport: "Jerseys",
    expected: true,
  },
  {
    title: "Oakley Sports Sunglasses Black",
    sport: null,
    expected: true,
  },
  {
    title: "Rolex Oyster Perpetual Collectible Wristwatch",
    sport: null,
    expected: true,
  },
  {
    title: "Adidas Ultraboost Men's Running Shoes Size 11",
    sport: null,
    expected: false,
  },
  {
    title: "Denver Broncos Nike T-Shirt Men's XL",
    sport: "Football",
    expected: false,
  },
  {
    title: "Denver Broncos Nike Jersey Men's XL",
    sport: "Football",
    expected: false,
  },
  {
    title: "Mass Air Flow Fuel Sensor Replacement Auto Part",
    sport: null,
    expected: false,
  },
] as const;'''
text, count = re.subn(
    r"const launchScopeCases = \[[\s\S]*?\] as const;",
    lambda _: new_cases,
    text,
    count=1,
)
if count != 1:
    raise SystemExit(f"Expected one launchScopeCases replacement; found {count}")
text = text.replace(
    "    isLaunchSportsCard(testCase),",
    "    isLaunchCollectible(testCase),",
    1,
)
text = text.replace(
    '  "eBay import, sports-card scope, and complete 1–20 image simulations passed: 48/48",',
    '  "eBay import, catalog exclusion, and complete 1–20 image simulations passed",',
    1,
)
admin.write_text(text)
print("Applied literal all-inventory launch contract")

taxonomy_test = Path("scripts/run-storefront-taxonomy-regressions.ts")
taxonomy_text = taxonomy_test.read_text()
marker = 'console.log("Storefront taxonomy regressions passed.");'
addition = '''assert.equal(
  isLaunchCollectible({ title: "Oakley Sports Sunglasses Black", sport: null }),
  true,
);
assert.equal(
  isLaunchCollectible({ title: "Collectible Wristwatch", sport: null }),
  true,
);

'''
if addition not in taxonomy_text:
    if marker not in taxonomy_text:
        raise SystemExit("Could not locate taxonomy regression completion marker")
    taxonomy_text = taxonomy_text.replace(marker, addition + marker, 1)
taxonomy_test.write_text(taxonomy_text)
print("Added default-allow storefront regressions")
