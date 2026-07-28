export type StorefrontFeatureKey =
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
  "Other Sports",
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
