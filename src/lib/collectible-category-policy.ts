export type CollectibleCategoryDecision = {
  isTradingCard: boolean;
  isPhysicalMemorabilia: boolean;
  category:
    | "sports_cards"
    | "trading_cards"
    | "memorabilia"
    | "autographs"
    | "other_collectable";
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

type CategoryPolicyInput = {
  title?: string | null;
  category?: string | null;
  sport?: string | null;
  aspects?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9#/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function flattenAspectText(aspects: Record<string, unknown>) {
  return Object.entries(aspects)
    .flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function metadataAspects(metadata: Record<string, unknown>) {
  const candidates = [
    metadata.source_aspects,
    metadata.ebay_aspects,
    metadata.aspects,
    recordValue(metadata.source_listing).aspects,
  ];

  return candidates.reduce<Record<string, unknown>>((combined, candidate) => {
    const record = recordValue(candidate);
    return { ...combined, ...record };
  }, {});
}

function explicitCardCategory(value: string) {
  return /\b(sports? cards?|trading cards?|trading card singles?|collectible cards?|non sport trading cards?|sealed trading cards?|ccg individual cards?)\b/.test(
    value,
  );
}

function explicitMemorabiliaCategory(value: string) {
  return /\b(memorabilia|sports memorabilia|autographs?|signed memorabilia)\b/.test(
    value,
  );
}

function cardAspectEvidence(aspects: Record<string, unknown>) {
  const text = normalized(flattenAspectText(aspects));
  const keys = normalized(Object.keys(aspects).join(" "));
  const keyEvidence =
    /\b(card number|set|parallel variety|parallel|insert set|print run|card name|card thickness)\b/.test(
      keys,
    );
  const valueEvidence =
    /\b(rookie|rc|parallel|insert|short print|ssp|sp|numbered|refractor|prizm|holo|young guns|patch card|relic card|autograph card)\b/.test(
      text,
    );
  return keyEvidence || valueEvidence;
}

function strongCardTitleEvidence(title: string) {
  const explicit =
    /\b(trading card|sports card|rookie card|autograph card|auto card|patch card|relic card|memorabilia card)\b/.test(
      title,
    );
  const cardLanguage =
    /\b(rc|rookie|young guns|future watch|rookie ticket|rpa|insert|parallel|refractor|prizm|holo|short print|ssp|sp card|card #|no\.?\s*\d+)\b/.test(
      title,
    );
  const cardBrands =
    /\b(topps|bowman|panini|upper deck|sp game used|the cup|artifacts|allure|o pee chee|opc|prizm|select|optic|mosaic|donruss|contenders|chronicles|immaculate|national treasures|flawless|finest|heritage|stadium club|leaf|fleer|score|skybox|metal universe|ud canvas|young guns)\b/.test(
      title,
    );
  const serialEvidence =
    /(?:^|\s)(?:#?[a-z]{0,4}\d{1,4}|\d{1,3}\/\d{1,4}|\/\d{1,4})(?:\s|$)/.test(
      title,
    );

  // A brand and year alone are not enough. Example: an Upper Deck
  // Authenticated 2024 signed jersey is still a physical jersey.
  return explicit || (cardBrands && (cardLanguage || serialEvidence));
}

function physicalObjectEvidence(title: string) {
  return /\b(signed|autographed|game used|game worn|team issued|player worn|inscribed)?\s*(jersey|puck|helmet|bat|baseball|football|basketball|soccer ball|hockey stick|stick|glove|cleats|shoes|photo|photograph|poster|program|magazine|cd cover|album cover|record cover|vinyl|book|index card)\b/.test(
    title,
  );
}

function sportLooksPresent(value: string) {
  return /\b(baseball|basketball|football|hockey|soccer|golf|tennis|racing|nascar|formula 1|f1|mma|ufc|wrestling|boxing|wnba|nba|nfl|nhl|mlb|mls)\b/.test(
    value,
  );
}

export function classifyCollectibleCategory(
  input: CategoryPolicyInput,
): CollectibleCategoryDecision {
  const metadata = recordValue(input.metadata);
  const aspects = {
    ...metadataAspects(metadata),
    ...recordValue(input.aspects),
  };
  const title = normalized(input.title);
  const category = normalized(input.category);
  const sport = normalized(input.sport);
  const combined = normalized(
    `${title} ${category} ${sport} ${flattenAspectText(aspects)} ${String(
      metadata.category_hint || "",
    )} ${String(metadata.trading_api_category_name || "")}`,
  );

  const reasons: string[] = [];
  const categorySaysCard =
    explicitCardCategory(category) || explicitCardCategory(combined);
  const aspectsSayCard = cardAspectEvidence(aspects);
  const titleSaysCard = strongCardTitleEvidence(title);
  const isTradingCard = categorySaysCard || aspectsSayCard || titleSaysCard;

  if (categorySaysCard) reasons.push("card category evidence");
  if (aspectsSayCard) reasons.push("card item-specific evidence");
  if (titleSaysCard) reasons.push("card title/set evidence");

  if (isTradingCard) {
    const sportsCard = sportLooksPresent(`${sport} ${combined}`);
    return {
      isTradingCard: true,
      isPhysicalMemorabilia: false,
      category: sportsCard ? "sports_cards" : "trading_cards",
      confidence: categorySaysCard || aspectsSayCard ? "high" : "medium",
      reasons: [
        ...reasons,
        "autograph/relic/patch words are card features, not category overrides",
      ],
    };
  }

  const physicalObject = physicalObjectEvidence(title);
  const memorabiliaCategory =
    explicitMemorabiliaCategory(category) ||
    explicitMemorabiliaCategory(combined);
  const autographOnly =
    /\b(autograph|autographed|signed|inscribed|coa|psa dna|beckett|jsa)\b/.test(
      combined,
    );

  if (physicalObject || memorabiliaCategory) {
    return {
      isTradingCard: false,
      isPhysicalMemorabilia: true,
      category: physicalObject
        ? "memorabilia"
        : autographOnly
          ? "autographs"
          : "memorabilia",
      confidence: physicalObject && memorabiliaCategory ? "high" : "medium",
      reasons: [
        ...(physicalObject ? ["physical collectible object evidence"] : []),
        ...(memorabiliaCategory ? ["memorabilia category evidence"] : []),
      ],
    };
  }

  return {
    isTradingCard: false,
    isPhysicalMemorabilia: false,
    category: autographOnly ? "autographs" : "other_collectable",
    confidence: "low",
    reasons: autographOnly ? ["autograph evidence without card evidence"] : [],
  };
}

export function tradingCardCategoryMetadata(params: {
  metadata?: Record<string, unknown> | null;
  previousCategory?: string | null;
  decision: CollectibleCategoryDecision;
}) {
  const metadata = recordValue(params.metadata);
  const now = new Date().toISOString();

  return {
    ...metadata,
    category_policy: {
      schema: "truely.collectibleCategoryPolicy.v1",
      category: params.decision.category,
      is_trading_card: params.decision.isTradingCard,
      is_physical_memorabilia: params.decision.isPhysicalMemorabilia,
      confidence: params.decision.confidence,
      reasons: params.decision.reasons,
      previous_category: params.previousCategory || null,
      evaluated_at: now,
      rule:
        "Trading-card identity takes precedence over autograph, patch, relic, jersey-swatch, game-used, or memorabilia feature words.",
    },
  };
}
