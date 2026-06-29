export type EbayAspectMap = Record<string, unknown>;

export type EbayCategoryMapping = {
  category: string;
  confidence: "high" | "medium" | "low";
  reviewRequired: boolean;
  evidence: string[];
  attributes: Record<string, string>;
};

type CategoryRule = {
  category: string;
  highTerms: string[];
  mediumTerms: string[];
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "sports_cards",
    highTerms: [
      "sports trading card",
      "trading card single",
      "rookie card",
      "psa ",
      "bgs ",
      "sgc ",
      "cgc ",
      "topps",
      "panini",
      "upper deck",
      "bowman",
      "donruss",
      "prizm",
      "refractor",
    ],
    mediumTerms: ["baseball", "basketball", "football", "hockey", "soccer", "ufc"],
  },
  {
    category: "trading_cards",
    highTerms: [
      "pokemon",
      "pokémon",
      "magic the gathering",
      "mtg",
      "yu-gi-oh",
      "yugioh",
      "lorcana",
      "tcg",
      "ccg",
    ],
    mediumTerms: ["booster", "foil card", "holo card", "deck"],
  },
  {
    category: "shoes",
    highTerms: [
      "sneaker",
      "shoe",
      "shoes",
      "jordan",
      "nike",
      "adidas",
      "new balance",
      "yeezy",
      "dunk low",
      "air max",
    ],
    mediumTerms: ["size ", "men's", "mens", "women's", "womens"],
  },
  {
    category: "comics",
    highTerms: ["comic book", "comics", "cgc comic", "marvel", "dc comics"],
    mediumTerms: ["issue #", "variant cover", "first appearance"],
  },
  {
    category: "sealed_wax",
    highTerms: [
      "hobby box",
      "blaster box",
      "mega box",
      "booster box",
      "sealed box",
      "sealed case",
      "wax box",
    ],
    mediumTerms: ["pack", "factory sealed", "sealed"],
  },
  {
    category: "autographs",
    highTerms: ["autograph", "autographed", "signed", "auto "],
    mediumTerms: ["coa", "jsa", "beckett authenticated", "psa dna"],
  },
  {
    category: "memorabilia",
    highTerms: ["memorabilia", "jersey", "helmet", "bat", "game used", "relic"],
    mediumTerms: ["patch", "framed", "display"],
  },
  {
    category: "coins",
    highTerms: ["coin", "silver dollar", "gold coin", "ngc", "pcgs"],
    mediumTerms: ["mint", "proof", "bullion"],
  },
  {
    category: "toys",
    highTerms: ["action figure", "funko", "lego", "hot wheels", "toy"],
    mediumTerms: ["figure", "diecast", "collectible toy"],
  },
];

const ATTRIBUTE_NAMES = [
  "Brand",
  "Card Manufacturer",
  "Character",
  "Convention/Event",
  "Features",
  "Franchise",
  "Grade",
  "Graded",
  "League",
  "Manufacturer",
  "Original/Licensed Reprint",
  "Parallel/Variety",
  "Player",
  "Player/Athlete",
  "Professional Grader",
  "Season",
  "Set",
  "Shoe Size",
  "Signed By",
  "Sport",
  "Team",
  "Type",
  "Vintage",
  "Year Manufactured",
];

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ") || null;
  }

  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasTerm(haystack: string, term: string) {
  return haystack.includes(term.toLowerCase());
}

function scoreRule(rule: CategoryRule, text: string) {
  const highMatches = rule.highTerms.filter((term) => hasTerm(text, term));
  const mediumMatches = rule.mediumTerms.filter((term) => hasTerm(text, term));
  const score = highMatches.length * 3 + mediumMatches.length;

  return {
    score,
    evidence: [...highMatches, ...mediumMatches],
  };
}

function confidence(score: number): EbayCategoryMapping["confidence"] {
  if (score >= 3) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function usefulAspectAttributes(aspects: EbayAspectMap) {
  const attributes: Record<string, string> = {};

  for (const name of ATTRIBUTE_NAMES) {
    const value = textValue(aspects[name]);

    if (value) {
      attributes[`ebay_aspect_${normalizeKey(name)}`] = value.slice(0, 500);
    }
  }

  return attributes;
}

export function mapEbayInventoryCategory(input: {
  title: string;
  description?: string | null;
  aspects?: EbayAspectMap | null;
}): EbayCategoryMapping {
  const aspects = input.aspects ?? {};
  const searchable = [
    input.title,
    input.description ?? "",
    ...Object.entries(aspects).flatMap(([key, value]) => [
      key,
      textValue(value) ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();

  const results = CATEGORY_RULES.map((rule) => ({
    ...scoreRule(rule, searchable),
    category: rule.category,
  })).sort((left, right) => right.score - left.score);

  const best = results[0];
  const mappingConfidence = confidence(best?.score ?? 0);
  const category =
    best && best.score > 0 ? best.category : "other_collectable";
  const reviewRequired = mappingConfidence === "low";
  const evidence = best?.evidence ?? [];

  return {
    category,
    confidence: mappingConfidence,
    reviewRequired,
    evidence,
    attributes: {
      tcos_category: category,
      tcos_category_confidence: mappingConfidence,
      tcos_review_required: String(reviewRequired),
      tcos_category_evidence: evidence.join(", "),
      ...usefulAspectAttributes(aspects),
    },
  };
}
