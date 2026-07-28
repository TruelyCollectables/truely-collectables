from pathlib import Path


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


def write(path: str, content: str) -> None:
    file_path = Path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content)
    print(f"Wrote: {path}")


write(
    "src/lib/storefront-taxonomy.ts",
    r'''export type StorefrontFeatureKey =
  | "autograph"
  | "rookie"
  | "graded"
  | "numbered";

export type StorefrontFeatureFlags = Record<StorefrontFeatureKey, boolean>;

export type StorefrontSort =
  | "section"
  | "newest"
  | "price_low"
  | "price_high"
  | "title";

export type StorefrontClassification = {
  section: string;
  league: string | null;
  features: StorefrontFeatureFlags;
  attributes: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type StorefrontFilterableItem = {
  legacyProductId: number;
  title: string;
  description?: string | null;
  player?: string | null;
  sport?: string | null;
  category?: string | null;
  storefrontSection?: string | null;
  league?: string | null;
  features?: Partial<StorefrontFeatureFlags> | null;
  price: number;
};

const SECTION_ORDER = [
  "Baseball",
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
  "Multi-Sport",
  "Trading Card Games",
  "Autographs",
  "Memorabilia",
  "Other Collectables",
] as const;

const SECTION_RANK = new Map<string, number>(
  SECTION_ORDER.map((section, index) => [section.toLowerCase(), index]),
);

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ") || null;
  }

  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function normalized(value: unknown) {
  return (textValue(value) || "").toLowerCase();
}

function aspectValue(aspects: Record<string, unknown>, name: string) {
  return textValue(aspects[name]);
}

function affirmative(value: unknown) {
  return ["1", "true", "yes", "y", "autographed", "signed"].includes(
    normalized(value),
  );
}

function metadataBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return null;
}

function detectSection(params: {
  title: string;
  rawSport?: unknown;
  primaryCategory?: string | null;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const storedSection = textValue(params.metadata.tcos_storefront_section);
  if (storedSection) return storedSection;

  const league = normalized(aspectValue(params.aspects, "League"));
  const sport = normalized(params.rawSport || aspectValue(params.aspects, "Sport"));
  const title = normalized(params.title);
  const focused = `${sport} ${league} ${title}`;

  if (/\bwnba\b|women'?s national basketball association/.test(focused)) {
    return "WNBA";
  }
  if (/\bbaseball\b|\bmlb\b|major league baseball/.test(focused)) {
    return "Baseball";
  }
  if (/\bbasketball\b|\bnba\b|national basketball association/.test(focused)) {
    return "Basketball";
  }
  if (/american football|\bfootball\b|\bnfl\b/.test(focused)) {
    return "Football";
  }
  if (/ice hockey|\bhockey\b|\bnhl\b/.test(focused)) {
    return "Hockey";
  }
  if (/\bsoccer\b|association football|\bmls\b/.test(focused)) {
    return "Soccer";
  }
  if (/professional wrestling|\bwrestling\b|\bwwe\b|\baew\b/.test(focused)) {
    return "Wrestling";
  }
  if (/mixed martial arts|\bmma\b|\bufc\b/.test(focused)) {
    return "MMA / UFC";
  }
  if (/\bboxing\b/.test(focused)) return "Boxing";
  if (/\bgolf\b|\bpga\b/.test(focused)) return "Golf";
  if (/\btennis\b|\batp\b|\bwta\b/.test(focused)) return "Tennis";
  if (/\bnascar\b|auto racing|motorsport|\bracing\b/.test(focused)) {
    return "Racing / NASCAR";
  }
  if (/multi[- ]sport/.test(focused)) return "Multi-Sport";

  switch (params.primaryCategory) {
    case "sports_cards":
      return "Other Sports";
    case "trading_cards":
    case "sealed_wax":
      return "Trading Card Games";
    case "autographs":
      return "Autographs";
    case "memorabilia":
      return "Memorabilia";
    default:
      return "Other Collectables";
  }
}

function detectFeatures(params: {
  title: string;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const features = normalized(aspectValue(params.aspects, "Features"));
  const signedBy = normalized(aspectValue(params.aspects, "Signed By"));
  const autographAuthentication = normalized(
    aspectValue(params.aspects, "Autograph Authentication"),
  );
  const parallel = normalized(aspectValue(params.aspects, "Parallel/Variety"));
  const title = normalized(params.title);
  const focused = `${title} ${features} ${signedBy} ${autographAuthentication} ${parallel}`;

  const storedAutograph = metadataBoolean(params.metadata, "tcos_is_autograph");
  const storedRookie = metadataBoolean(params.metadata, "tcos_is_rookie");
  const storedGraded = metadataBoolean(params.metadata, "tcos_is_graded");
  const storedNumbered = metadataBoolean(params.metadata, "tcos_is_numbered");

  const autograph =
    storedAutograph ??
    (affirmative(aspectValue(params.aspects, "Autographed")) ||
      Boolean(signedBy) ||
      Boolean(autographAuthentication) ||
      /\bautograph(?:ed)?\b|\bsigned\b|\bsignature\b|\bauto\b/.test(focused));

  const rookie =
    storedRookie ??
    (/\brookie\b|\brc\b|rated rookie|young guns/.test(`${title} ${features}`));

  const graded =
    storedGraded ??
    (affirmative(aspectValue(params.aspects, "Graded")) ||
      Boolean(aspectValue(params.aspects, "Professional Grader")) ||
      /\b(?:psa|bgs|sgc|cgc|csg|hga)\s*(?:10|9\.5|9|8\.5|8)\b/.test(title));

  const numbered =
    storedNumbered ??
    (/\b\d{1,5}\s*\/\s*\d{1,5}\b|serial numbered|\bnumbered\b|#'?d\b/.test(
      `${title} ${features} ${parallel}`,
    ));

  return { autograph, rookie, graded, numbered };
}

export function classifyStorefrontItem(input: {
  title: string;
  description?: string | null;
  rawSport?: unknown;
  primaryCategory?: string | null;
  aspects?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): StorefrontClassification {
  const aspects = input.aspects || {};
  const metadata = input.metadata || {};
  const league =
    textValue(metadata.tcos_league) || aspectValue(aspects, "League") || null;
  const section = detectSection({
    title: input.title,
    rawSport: input.rawSport,
    primaryCategory: input.primaryCategory,
    aspects,
    metadata,
  });
  const features = detectFeatures({ title: input.title, aspects, metadata });

  return {
    section,
    league,
    features,
    attributes: {
      tcos_storefront_section: section,
      tcos_league: league || "",
      tcos_is_autograph: String(features.autograph),
      tcos_is_rookie: String(features.rookie),
      tcos_is_graded: String(features.graded),
      tcos_is_numbered: String(features.numbered),
      tcos_taxonomy_version: "2",
    },
    metadata: {
      tcos_storefront_section: section,
      tcos_league: league,
      tcos_is_autograph: features.autograph,
      tcos_is_rookie: features.rookie,
      tcos_is_graded: features.graded,
      tcos_is_numbered: features.numbered,
      tcos_taxonomy_version: 2,
    },
  };
}

export function normalizeStorefrontFeature(value: string | null | undefined) {
  const normalizedValue = normalized(value);
  if (["auto", "autos", "autograph", "autographs", "signed"].includes(normalizedValue)) {
    return "autograph" as const;
  }
  if (["rookie", "rookies", "rc"].includes(normalizedValue)) return "rookie" as const;
  if (["graded", "grade"].includes(normalizedValue)) return "graded" as const;
  if (["numbered", "serial", "serial numbered"].includes(normalizedValue)) {
    return "numbered" as const;
  }
  return null;
}

export function matchesStorefrontFilters(
  item: StorefrontFilterableItem,
  filters: {
    query?: string;
    section?: string;
    feature?: string;
    category?: string;
  },
) {
  const feature = normalizeStorefrontFeature(filters.feature);
  if (feature && !item.features?.[feature]) return false;

  if (
    filters.section &&
    normalized(item.storefrontSection || item.sport) !== normalized(filters.section)
  ) {
    return false;
  }

  if (filters.category && normalized(item.category) !== normalized(filters.category)) {
    return false;
  }

  const queryTokens = normalized(filters.query)
    .split(" ")
    .filter(Boolean);
  if (!queryTokens.length) return true;

  const enabledFeatures = Object.entries(item.features || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(" ");
  const searchable = normalized(
    [
      item.title,
      item.description,
      item.player,
      item.sport,
      item.storefrontSection,
      item.league,
      item.category,
      enabledFeatures,
    ].join(" "),
  );

  return queryTokens.every((token) => searchable.includes(token));
}

export function storefrontSectionRank(section: string | null | undefined) {
  return SECTION_RANK.get(normalized(section)) ?? SECTION_ORDER.length;
}

export function sortStorefrontSections(sections: string[]) {
  return Array.from(new Set(sections.filter(Boolean))).sort(
    (left, right) =>
      storefrontSectionRank(left) - storefrontSectionRank(right) ||
      left.localeCompare(right),
  );
}

export function sortStorefrontItems<T extends StorefrontFilterableItem>(
  items: T[],
  sort: StorefrontSort = "section",
) {
  if (sort === "newest") return [...items];

  return [...items].sort((left, right) => {
    if (sort === "price_low") return left.price - right.price;
    if (sort === "price_high") return right.price - left.price;
    if (sort === "title") return left.title.localeCompare(right.title);

    return (
      storefrontSectionRank(left.storefrontSection || left.sport) -
        storefrontSectionRank(right.storefrontSection || right.sport) ||
      (left.player || "").localeCompare(right.player || "") ||
      left.title.localeCompare(right.title) ||
      left.legacyProductId - right.legacyProductId
    );
  });
}
''',
)

write(
    "scripts/run-storefront-taxonomy-regressions.ts",
    r'''import assert from "node:assert/strict";
import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
import {
  classifyStorefrontItem,
  matchesStorefrontFilters,
  sortStorefrontItems,
} from "../src/lib/storefront-taxonomy";

const wnbaAuto = {
  title: "2024 Panini Prizm WNBA Caitlin Clark Rookie Auto /25",
  rawSport: "Basketball",
  primaryCategory: "sports_cards",
  aspects: {
    League: ["Women's National Basketball Association (WNBA)"],
    Autographed: ["Yes"],
    Features: ["Rookie, Serial Numbered"],
  },
};

const wnba = classifyStorefrontItem(wnbaAuto);
assert.equal(wnba.section, "WNBA");
assert.equal(wnba.features.autograph, true);
assert.equal(wnba.features.rookie, true);
assert.equal(wnba.features.numbered, true);

const signedBaseball = mapEbayInventoryCategory({
  title: "2023 Topps Chrome Baseball Mike Trout Autograph Card",
  aspects: {
    Sport: ["Baseball"],
    Autographed: ["Yes"],
    Features: ["Autograph"],
  },
});
assert.equal(signedBaseball.category, "sports_cards");
assert.equal(signedBaseball.attributes.tcos_is_autograph, "true");

const baseball = classifyStorefrontItem({
  title: "2023 Topps Chrome Mike Trout Auto",
  rawSport: "Baseball",
  primaryCategory: signedBaseball.category,
  aspects: { Autographed: ["Yes"] },
});
assert.equal(baseball.section, "Baseball");
assert.equal(baseball.features.autograph, true);

const hockey = classifyStorefrontItem({
  title: "2024 Upper Deck Young Guns",
  rawSport: "Ice Hockey",
  primaryCategory: "sports_cards",
});
assert.equal(hockey.section, "Hockey");
assert.equal(hockey.features.rookie, true);

const inventory = [
  {
    legacyProductId: 1,
    title: "Basketball Base",
    player: "Z Player",
    price: 5,
    storefrontSection: "Basketball",
    features: { autograph: false, rookie: false, graded: false, numbered: false },
  },
  {
    legacyProductId: 2,
    title: "Baseball Signed",
    player: "A Player",
    price: 10,
    storefrontSection: "Baseball",
    features: { autograph: true, rookie: false, graded: false, numbered: false },
  },
  {
    legacyProductId: 3,
    title: "WNBA Signed",
    player: "C Player",
    price: 20,
    storefrontSection: "WNBA",
    features: { autograph: true, rookie: true, graded: false, numbered: false },
  },
];

assert.deepEqual(
  inventory
    .filter((item) => matchesStorefrontFilters(item, { feature: "autographs" }))
    .map((item) => item.legacyProductId),
  [2, 3],
);
assert.deepEqual(
  inventory
    .filter((item) => matchesStorefrontFilters(item, { section: "WNBA" }))
    .map((item) => item.legacyProductId),
  [3],
);
assert.deepEqual(
  sortStorefrontItems(inventory, "section").map((item) => item.legacyProductId),
  [2, 3, 1],
);

console.log("Storefront taxonomy regressions passed.");
''',
)

write(
    ".github/workflows/storefront-taxonomy.yml",
    r'''name: Storefront Taxonomy and Filters

on:
  pull_request:
    paths:
      - "src/lib/storefront-taxonomy.ts"
      - "src/lib/ebay-category-mapper.ts"
      - "src/lib/ebay-sync.ts"
      - "src/modules/inventory/**"
      - "src/app/shop/**"
      - "src/app/page.tsx"
      - "src/app/components/Navbar.tsx"
      - "scripts/run-storefront-taxonomy-regressions.ts"
      - ".github/workflows/storefront-taxonomy.yml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  storefront-taxonomy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY: build-only-placeholder-anon-key
      SUPABASE_SERVICE_ROLE_KEY: build-only-placeholder-service-role-key
      ADMIN_SESSION_SECRET: build-only-placeholder-session-secret
      NEXT_PUBLIC_SITE_URL: https://truelycollectables.com
      STRIPE_SECRET_KEY: sk_test_build_only_placeholder
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk_test_build_only_placeholder
      STRIPE_WEBHOOK_SECRET: whsec_build_only_placeholder
      EBAY_CLIENT_ID: build-only-placeholder-client-id
      EBAY_CLIENT_SECRET: build-only-placeholder-client-secret
      EBAY_ENVIRONMENT: production
      TCOS_LIVE_PAYMENTS_ENABLED: "false"
      TCOS_SHIPPING_PURCHASE_MODE: dry_run
      TCOS_LIVE_SHIPPING_ENABLED: "false"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Run storefront taxonomy regressions
        run: node --import tsx scripts/run-storefront-taxonomy-regressions.ts
      - name: Lint storefront taxonomy paths
        run: >-
          npx eslint
          src/lib/storefront-taxonomy.ts
          src/lib/ebay-category-mapper.ts
          src/lib/ebay-sync.ts
          src/modules/inventory/types.ts
          src/modules/inventory/repository.ts
          src/modules/inventory/engine.ts
          src/app/shop/page.tsx
          src/app/page.tsx
          src/app/components/Navbar.tsx
          scripts/run-storefront-taxonomy-regressions.ts
      - name: Build production application
        run: npm run build
''',
)

# Autographs remain a feature of sports cards instead of replacing the primary category.
replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''function preferSportsCardOverDescriptionNoise(params: {
  title: string;
  aspects: EbayAspectMap;
  currentCategory: string;
}) {
  if (params.currentCategory !== "autographs") return false;
  if (hasStrongAutographEvidence(params.title, params.aspects)) return false;

  const focused = `${params.title} ${aspectSearchText(params.aspects)}`;
  const sportsCardScore =
    scoreRule(CATEGORY_RULES[0], focused.toLowerCase()).score;

  return sportsCardScore >= 3;
}
''',
    '''function preferSportsCardAsPrimaryCategory(params: {
  title: string;
  aspects: EbayAspectMap;
  currentCategory: string;
}) {
  if (params.currentCategory !== "autographs") return false;

  const focused = `${params.title} ${aspectSearchText(params.aspects)}`;
  const sportsCardScore =
    scoreRule(CATEGORY_RULES[0], focused.toLowerCase()).score;

  return sportsCardScore >= 3;
}
''',
    "sports card primary category helper",
)
replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''    preferSportsCardOverDescriptionNoise({
''',
    '''    preferSportsCardAsPrimaryCategory({
''',
    "sports card primary category call",
)
replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''  if (
    best?.category === "sports_cards" &&
    hasStrongAutographEvidence(input.title, aspects)
  ) {
    const autographResult = focusedResults.find(
      (result) => result.category === "autographs" && result.score > 0,
    );

    if (autographResult) {
      best = autographResult;
    }
  }

''',
    '''''',
    "remove autograph category override",
)
replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''      tcos_category_evidence: evidence.join(", "),
      ...usefulAspectAttributes(aspects),
''',
    '''      tcos_category_evidence: evidence.join(", "),
      tcos_is_autograph: String(hasStrongAutographEvidence(input.title, aspects)),
      ...usefulAspectAttributes(aspects),
''',
    "autograph category feature attribute",
)

# Persist normalized taxonomy during every eBay import.
replace_once(
    "src/lib/ebay-sync.ts",
    '''import { mapEbayInventoryCategory } from "./ebay-category-mapper";
''',
    '''import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { classifyStorefrontItem } from "./storefront-taxonomy";
''',
    "eBay taxonomy import",
)
replace_once(
    "src/lib/ebay-sync.ts",
    '''    const sport = first(aspects.Sport);
    const categoryMapping = mapEbayInventoryCategory({
      title: product.title || "Untitled",
      description: product.description || offer.listingDescription || "",
      aspects,
    });

    const productData = {
''',
    '''    const rawSport = first(aspects.Sport);
    const categoryMapping = mapEbayInventoryCategory({
      title: product.title || "Untitled",
      description: product.description || offer.listingDescription || "",
      aspects,
    });
    const storefront = classifyStorefrontItem({
      title: product.title || "Untitled",
      description: product.description || offer.listingDescription || "",
      rawSport,
      primaryCategory: categoryMapping.category,
      aspects,
    });

    const productData = {
''',
    "eBay storefront classification",
)
replace_once(
    "src/lib/ebay-sync.ts",
    '''      sport,
''',
    '''      sport: storefront.section,
''',
    "normalized imported sport",
)
replace_once(
    "src/lib/ebay-sync.ts",
    '''        attributes: categoryMapping.attributes,
''',
    '''        attributes: {
          ...categoryMapping.attributes,
          ...storefront.attributes,
        },
        metadata: storefront.metadata,
''',
    "persist storefront attributes and metadata",
)

# Extend universal inventory items with storefront facets.
replace_once(
    "src/modules/inventory/types.ts",
    '''export type UniversalInventoryItem = {
''',
    '''export type StorefrontFeatureFlags = {
  autograph: boolean;
  rookie: boolean;
  graded: boolean;
  numbered: boolean;
};

export type UniversalInventoryItem = {
''',
    "storefront feature type",
)
replace_once(
    "src/modules/inventory/types.ts",
    '''  sport: string | null;
  price: number;
''',
    '''  sport: string | null;
  category: string | null;
  storefrontSection: string;
  league: string | null;
  features: StorefrontFeatureFlags;
  price: number;
''',
    "universal storefront fields",
)

# Preserve existing metadata while refreshing taxonomy metadata.
replace_once(
    "src/modules/inventory/repository.ts",
    '''    const existing = existingByLegacyProductId ?? (await this.getBySku(input.sku));
    const payload = {
''',
    '''    const existing = existingByLegacyProductId ?? (await this.getBySku(input.sku));
    const mergedMetadata =
      input.metadata === undefined
        ? undefined
        : { ...(existing?.metadata || {}), ...(input.metadata || {}) };
    const payload = {
''',
    "merge inventory metadata",
)
replace_once(
    "src/modules/inventory/repository.ts",
    '''    if (input.metadata !== undefined) {
      Object.assign(payload, { metadata: input.metadata ?? {} });
    }
''',
    '''    if (mergedMetadata !== undefined) {
      Object.assign(payload, { metadata: mergedMetadata });
    }
''',
    "save merged inventory metadata",
)

# Classify, filter and sort storefront inventory deterministically.
replace_once(
    "src/modules/inventory/engine.ts",
    '''import { getStoreSettings } from "../../lib/store-settings";
''',
    '''import { getStoreSettings } from "../../lib/store-settings";
import {
  classifyStorefrontItem,
  matchesStorefrontFilters,
  sortStorefrontItems,
  sortStorefrontSections,
  type StorefrontSort,
} from "../../lib/storefront-taxonomy";
''',
    "inventory taxonomy imports",
)
replace_once(
    "src/modules/inventory/engine.ts",
    '''  attributes?: Record<string, string | null>;
};
''',
    '''  attributes?: Record<string, string | null>;
  metadata?: Record<string, unknown>;
};
''',
    "eBay inventory metadata input",
)
replace_once(
    "src/modules/inventory/engine.ts",
    '''function mapUniversal(
  product: LegacyProductSnapshot,
  inventoryItem: InventoryItem | null
): UniversalInventoryItem {
  if (inventoryItem) {
    const authenticity = extractAuthenticityProfile(inventoryItem.metadata);

    return {
      inventoryItemId: inventoryItem.id,
      legacyProductId: product.id,
      sellerAccountId:
        inventoryItem.seller_account_id ?? product.seller_account_id ?? null,
      sku: inventoryItem.sku ?? product.sku,
      title: inventoryItem.title,
      description: inventoryItem.description ?? product.description,
      player: product.player ?? null,
      sport: product.sport ?? null,
      price: toNumber(inventoryItem.price),
      quantity: toNumber(inventoryItem.quantity),
      imageUrl: product.image_url,
      ebayItemId: product.ebay_item_id,
      status: inventoryItem.status,
      source: "inventory_items",
      authenticity,
    };
  }

  return {
    inventoryItemId: null,
    legacyProductId: product.id,
    sellerAccountId: product.seller_account_id ?? null,
    sku: product.sku,
    title: product.title,
    description: product.description,
    player: product.player ?? null,
    sport: product.sport ?? null,
    price: product.price,
    quantity: product.quantity,
    imageUrl: product.image_url,
    ebayItemId: product.ebay_item_id,
    status: normalizeStatus(product.quantity),
    source: "products",
    authenticity: extractAuthenticityProfile(null),
  };
}
''',
    '''function mapUniversal(
  product: LegacyProductSnapshot,
  inventoryItem: InventoryItem | null
): UniversalInventoryItem {
  const title = inventoryItem?.title ?? product.title;
  const description = inventoryItem?.description ?? product.description;
  const classification = classifyStorefrontItem({
    title,
    description,
    rawSport: product.sport,
    primaryCategory: inventoryItem?.category ?? null,
    metadata: inventoryItem?.metadata ?? null,
  });

  if (inventoryItem) {
    const authenticity = extractAuthenticityProfile(inventoryItem.metadata);

    return {
      inventoryItemId: inventoryItem.id,
      legacyProductId: product.id,
      sellerAccountId:
        inventoryItem.seller_account_id ?? product.seller_account_id ?? null,
      sku: inventoryItem.sku ?? product.sku,
      title,
      description,
      player: product.player ?? null,
      sport: classification.section,
      category: inventoryItem.category,
      storefrontSection: classification.section,
      league: classification.league,
      features: classification.features,
      price: toNumber(inventoryItem.price),
      quantity: toNumber(inventoryItem.quantity),
      imageUrl: product.image_url,
      ebayItemId: product.ebay_item_id,
      status: inventoryItem.status,
      source: "inventory_items",
      authenticity,
    };
  }

  return {
    inventoryItemId: null,
    legacyProductId: product.id,
    sellerAccountId: product.seller_account_id ?? null,
    sku: product.sku,
    title,
    description,
    player: product.player ?? null,
    sport: classification.section,
    category: null,
    storefrontSection: classification.section,
    league: classification.league,
    features: classification.features,
    price: product.price,
    quantity: product.quantity,
    imageUrl: product.image_url,
    ebayItemId: product.ebay_item_id,
    status: normalizeStatus(product.quantity),
    source: "products",
    authenticity: extractAuthenticityProfile(null),
  };
}
''',
    "universal storefront classification",
)
replace_once(
    "src/modules/inventory/engine.ts",
    '''  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {}
  ): Promise<UniversalInventoryItem[]> {
    let query = this.database
      .from("products")
      .select("*")
      .eq("store_id", this.storeId)
      .gt("price", 0)
      .order("created_at", { ascending: false });

    if (params.query) {
      const safeQuery = params.query.replaceAll(",", " ").replaceAll("%", "").trim();

      if (safeQuery) {
        query = query.or(
          `title.ilike.%${safeQuery}%,player.ilike.%${safeQuery}%,sport.ilike.%${safeQuery}%`
        );
      }
    }

    if (params.sport) {
      query = query.eq("sport", params.sport);
    }

    const [
      { data: products, error },
      { data: inventoryItems, error: inventoryError },
    ] = await Promise.all([
      query,
      this.database
        .from("inventory_items")
        .select("*")
        .eq("store_id", this.storeId),
    ]);

    if (error) throw error;
    if (inventoryError) throw inventoryError;

    return this.mapProductsWithInventory(products ?? [], inventoryItems ?? []).filter(
      (item) =>
        item.inventoryItemId &&
        item.imageUrl &&
        item.quantity > 0 &&
        item.status === "active",
    );
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(items.map((item) => item.sport).filter(Boolean) as string[])
    ).sort();
  }
''',
    '''  async listAvailable(
    params: {
      query?: string;
      sport?: string;
      section?: string;
      feature?: string;
      category?: string;
      sort?: StorefrontSort;
    } = {}
  ): Promise<UniversalInventoryItem[]> {
    const [
      { data: products, error },
      { data: inventoryItems, error: inventoryError },
    ] = await Promise.all([
      this.database
        .from("products")
        .select("*")
        .eq("store_id", this.storeId)
        .gt("price", 0)
        .order("created_at", { ascending: false }),
      this.database
        .from("inventory_items")
        .select("*")
        .eq("store_id", this.storeId),
    ]);

    if (error) throw error;
    if (inventoryError) throw inventoryError;

    const section = params.section || params.sport;
    const available = this.mapProductsWithInventory(products ?? [], inventoryItems ?? [])
      .filter(
        (item) =>
          item.inventoryItemId &&
          item.imageUrl &&
          item.quantity > 0 &&
          item.status === "active",
      )
      .filter((item) =>
        matchesStorefrontFilters(item, {
          query: params.query,
          section,
          feature: params.feature,
          category: params.category,
        }),
      );

    return sortStorefrontItems(available, params.sort || "section");
  }

  async listAvailableSections(): Promise<string[]> {
    const items = await this.listAvailable({ sort: "newest" });
    return sortStorefrontSections(items.map((item) => item.storefrontSection));
  }

  async listAvailableSports(): Promise<string[]> {
    return this.listAvailableSections();
  }
''',
    "storefront list filters and sorting",
)
replace_once(
    "src/modules/inventory/engine.ts",
    '''      notes: notes || null,
    });
''',
    '''      notes: notes || null,
      metadata: input.metadata,
    });
''',
    "storefront metadata upsert",
)

# Replace the shop with explicit sections, feature filters and stable sorting.
write(
    "src/app/shop/page.tsx",
    r'''import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import type { StorefrontSort } from "../../lib/storefront-taxonomy";
import type { UniversalInventoryItem } from "../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop Sports Cards",
  description:
    "Shop live sports-card inventory from Truely Collectables by player, sport, league, rookie, autograph, grade, parallel, or card number.",
  alternates: { canonical: "/shop" },
};

const QUICK_SECTIONS = ["Baseball", "WNBA", "Basketball", "Football", "Hockey"];

function shopHref(params: {
  section?: string;
  feature?: string;
  sort?: string;
}) {
  const search = new URLSearchParams();
  if (params.section) search.set("section", params.section);
  if (params.feature) search.set("feature", params.feature);
  if (params.sort && params.sort !== "section") search.set("sort", params.sort);
  const query = search.toString();
  return query ? `/shop?${query}` : "/shop";
}

function heading(params: { section: string; feature: string }) {
  if (params.feature === "autograph") return "Autographs";
  if (params.feature === "rookie") return "Rookie Cards";
  if (params.feature === "graded") return "Graded Cards";
  if (params.feature === "numbered") return "Numbered Cards";
  return params.section || "Shop Sports Cards";
}

function FeatureBadges({ product }: { product: UniversalInventoryItem }) {
  const badges = [
    product.features.autograph ? "Autograph" : null,
    product.features.rookie ? "Rookie" : null,
    product.features.graded ? "Graded" : null,
    product.features.numbered ? "Numbered" : null,
  ].filter(Boolean) as string[];

  if (!badges.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide"
        >
          {badge}
        </span>
      ))}
    </div>
  );
}

export default async function Shop({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    sport?: string;
    section?: string;
    feature?: string;
    sort?: StorefrontSort;
  }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const section = (params?.section || params?.sport || "").trim();
  const feature = (params?.feature || "").trim();
  const sort: StorefrontSort = params?.sort || "section";

  let products: UniversalInventoryItem[] = [];
  let sections: string[] = [];
  let error: Error | null = null;

  try {
    const inventoryEngine = createServerInventoryEngine();
    products = await inventoryEngine.listAvailable({
      query: q,
      section,
      feature,
      sort,
    });
    sections = await inventoryEngine.listAvailableSections();
  } catch (err: any) {
    error = err;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-black">Error loading products</h1>
        <p className="mt-3 break-words text-sm text-red-700">{error.message}</p>
      </main>
    );
  }

  const activeFilters = Boolean(q || section || feature || sort !== "section");
  const quickSections = QUICK_SECTIONS.filter((name) => sections.includes(name));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ClearCartOnSuccess />

      <section className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-bold uppercase text-neutral-500">Active Inventory</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl md:text-5xl">
            {heading({ section, feature })}
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-600">
            Sports stay in their correct section. Autographs, rookies, graded cards,
            and numbered cards can be filtered across every sport.
          </p>
        </div>
        <p className="rounded bg-white px-4 py-2 text-sm font-bold text-neutral-700">
          {products.length.toLocaleString()} active cards
        </p>
      </section>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Popular card sections">
        <Link href="/shop" className="rounded-full border-2 border-neutral-950 bg-white px-4 py-2 text-sm font-black hover:bg-yellow-300">
          All Cards
        </Link>
        {quickSections.map((name) => (
          <Link
            key={name}
            href={shopHref({ section: name })}
            className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
          >
            {name}
          </Link>
        ))}
        <Link
          href={shopHref({ feature: "autograph" })}
          className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${feature === "autograph" ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
        >
          Autographs
        </Link>
      </nav>

      <form className="mb-8 grid grid-cols-1 gap-3 rounded border bg-white p-3 sm:p-4 md:grid-cols-6">
        <input
          type="search"
          name="q"
          placeholder="Player, set, team, card number..."
          defaultValue={q}
          className="min-h-12 rounded border px-4 py-3 text-base md:col-span-2"
        />

        <select name="section" defaultValue={section} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="">All Sections</option>
          {sections.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <select name="feature" defaultValue={feature} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="">All Card Types</option>
          <option value="autograph">Autographs</option>
          <option value="rookie">Rookies</option>
          <option value="graded">Graded</option>
          <option value="numbered">Numbered</option>
        </select>

        <select name="sort" defaultValue={sort} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="section">Section, Player, Title</option>
          <option value="newest">Newest First</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
          <option value="title">Title A–Z</option>
        </select>

        <button type="submit" className="min-h-12 rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800">
          Apply
        </button>
      </form>

      {activeFilters ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-bold">
          <span>Filtered inventory</span>
          <Link href="/shop" className="underline decoration-yellow-300 decoration-4 underline-offset-4">
            Clear all filters
          </Link>
        </div>
      ) : null}

      {products.length === 0 ? <p className="text-gray-600">No cards found.</p> : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => {
          const storefrontImage = preferHighResolutionListingImage(product.imageUrl) || "/placeholder.png";

          return (
            <article key={product.legacyProductId} className="overflow-hidden rounded border bg-white">
              <Link href={`/product/${product.legacyProductId}`} className="block" aria-label={`View ${product.title}`}>
                <div className="relative aspect-[4/5] bg-neutral-100">
                  <Image
                    src={storefrontImage}
                    alt={product.title}
                    fill
                    sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    quality={90}
                    className="object-contain p-2"
                  />
                </div>
              </Link>

              <div className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-700">
                  {product.storefrontSection}
                </p>
                <h2 className="mt-2 line-clamp-2 min-h-14 text-lg font-black leading-7">
                  {product.title}
                </h2>
                <p className="mt-2 text-sm text-neutral-500">
                  {product.player || product.league || "Sports Card"}
                </p>
                <FeatureBadges product={product} />

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-2xl font-black">${Number(product.price).toFixed(2)}</p>
                  <p className="rounded bg-neutral-100 px-2 py-1 text-xs font-bold text-neutral-600">
                    Qty {product.quantity}
                  </p>
                </div>

                <Link href={`/product/${product.legacyProductId}`} className="mt-4 flex min-h-11 w-full items-center justify-center rounded border border-neutral-950 px-4 py-2 text-center font-bold hover:bg-neutral-950 hover:text-white">
                  View Card
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
''',
)

write(
    "src/app/components/Navbar.tsx",
    r'''import Link from "next/link";
import { STORE_BRAND_NAME } from "../../lib/legal";

const navigationLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?feature=rookie", label: "Rookies" },
  { href: "/shop?feature=autograph", label: "Autos" },
  { href: "/shop?feature=graded", label: "Graded" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

function storeMark(value: string) {
  const initials = value
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "TC";
}

function NavigationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center justify-center whitespace-nowrap text-sm font-black text-neutral-800 hover:underline hover:decoration-yellow-300 hover:decoration-4 hover:underline-offset-4"
    >
      {label}
    </Link>
  );
}

export default function Navbar() {
  return (
    <>
      <div className="border-b-2 border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-[11px] font-black uppercase tracking-[0.16em] text-yellow-300 sm:text-xs">
        Real sports cards · live inventory · secure checkout · tracking included
      </div>
      <nav className="sticky top-0 z-50 w-full border-b-2 border-neutral-950 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-3"
              aria-label={`${STORE_BRAND_NAME} home`}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-neutral-950 bg-yellow-300 text-sm font-black uppercase shadow-[3px_3px_0_#111318]">
                {storeMark(STORE_BRAND_NAME)}
              </div>
              <div className="min-w-0">
                <span className="block truncate text-base font-black leading-none tracking-tight sm:text-xl">
                  {STORE_BRAND_NAME}
                </span>
                <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
                  The Card Wall
                </span>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-5 lg:flex">
                {navigationLinks.map((item) => (
                  <NavigationLink key={item.href} {...item} />
                ))}
              </div>

              <Link
                href="/cart"
                className="inline-flex min-h-11 items-center justify-center border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-[3px_3px_0_#111318] transition hover:-translate-y-0.5"
              >
                Cart
              </Link>
            </div>
          </div>

          <div className="-mx-4 mt-3 overflow-x-auto border-t border-neutral-200 px-4 pt-2 lg:hidden sm:-mx-6 sm:px-6">
            <div className="flex min-w-max items-center gap-5" aria-label="Mobile store navigation">
              {navigationLinks.map((item) => (
                <NavigationLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
''',
)

replace_once(
    "src/app/page.tsx",
    '''function sportHref(sport: string) {
  return `/shop?sport=${encodeURIComponent(sport)}`;
}
''',
    '''function sportHref(section: string) {
  return `/shop?section=${encodeURIComponent(section)}`;
}
''',
    "homepage section href",
)
replace_once(
    "src/app/page.tsx",
    '''      const sport = product.sport?.trim();
''',
    '''      const sport = product.storefrontSection?.trim();
''',
    "homepage normalized section counts",
)
replace_once(
    "src/app/page.tsx",
    '''                ["Rookie Cards", "/shop?q=rookie"],
                ["Autographs", "/shop?q=autograph"],
                ["Numbered", "/shop?q=%2F"],
                ["Graded", "/shop?q=PSA"],
''',
    '''                ["Rookie Cards", "/shop?feature=rookie"],
                ["Autographs", "/shop?feature=autograph"],
                ["Numbered", "/shop?feature=numbered"],
                ["Graded", "/shop?feature=graded"],
''',
    "homepage feature links",
)
replace_once(
    "src/app/page.tsx",
    '''                      {card.sport || "Sports Card"}
''',
    '''                      {card.storefrontSection || "Sports Card"}
''',
    "homepage card section label",
)

print("Storefront taxonomy patch complete.")
