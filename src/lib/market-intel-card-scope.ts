import "server-only";

export type MarketIntelCardScopeInput = {
  sportOrCategory?: string | null;
  leagueOrBrand?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  productLine?: string | null;
  setName?: string | null;
  displayName?: string | null;
  listingTitle?: string | null;
};

const BLOCKED_UNLICENSED_TERMS = [
  "leaf",
  "wild card",
  "wildcard",
  "onyx",
  "sage",
  "press pass",
  "tristar",
  "aceo",
  "custom card",
  "custom made",
  "homemade",
  "art card",
  "proxy",
  "reprint",
  "unlicensed",
  "logo less",
  "logoless",
  "no logo",
];

const BLOCKED_AMATEUR_TERMS = [
  "college",
  "ncaa",
  "university",
  "nil",
  "high school",
  "prep school",
  "amateur",
  "perfect game",
  "team usa",
  "usa baseball",
  "bowman u",
  "topps university",
  "prizm draft picks",
  "contenders draft picks",
  "chronicles draft picks",
  "select draft picks",
  "national signing day",
  "all american bowl",
];

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(text: string, term: string) {
  return text.includes(normalize(term));
}

export function growthProfessionalCardEligibility(
  input: MarketIntelCardScopeInput,
) {
  const productText = normalize(
    [
      input.manufacturer,
      input.brand,
      input.productLine,
      input.setName,
      input.displayName,
      input.listingTitle,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const sport = normalize(input.sportOrCategory);
  const league = normalize(input.leagueOrBrand);
  const rejectedTerms = [
    ...BLOCKED_UNLICENSED_TERMS,
    ...BLOCKED_AMATEUR_TERMS,
  ].filter((term) => containsTerm(productText, term));

  if (rejectedTerms.length > 0) {
    return {
      eligible: false,
      scope: "blocked",
      reasons: [],
      rejectionReasons: rejectedTerms.map(
        (term) => `Blocked product signal: ${term}`,
      ),
    };
  }

  const baseballScope =
    sport.includes("baseball") ||
    league.includes("mlb") ||
    league.includes("miami marlins");
  const wnbaScope =
    league.includes("wnba") ||
    productText.includes("wnba");

  if (baseballScope) {
    const licensedBaseball = ["topps", "bowman", "fanatics"].some((term) =>
      productText.includes(term),
    );
    return licensedBaseball
      ? {
          eligible: true,
          scope: "licensed_professional_baseball",
          reasons: ["Licensed professional Topps/Bowman/Fanatics baseball product"],
          rejectionReasons: [],
        }
      : {
          eligible: false,
          scope: "baseball",
          reasons: [],
          rejectionReasons: [
            "Baseball Growth Specs require a licensed Topps, Bowman, or Fanatics professional product.",
          ],
        };
  }

  if (wnbaScope) {
    const licensedWnbaManufacturer = ["panini", "topps", "fanatics"].some(
      (term) => productText.includes(term),
    );
    const professionalWnbaSignal =
      league.includes("wnba") || productText.includes("wnba");
    return licensedWnbaManufacturer && professionalWnbaSignal
      ? {
          eligible: true,
          scope: "licensed_professional_wnba",
          reasons: ["Licensed professional WNBA product"],
          rejectionReasons: [],
        }
      : {
          eligible: false,
          scope: "wnba",
          reasons: [],
          rejectionReasons: [
            "WNBA Growth Specs require an officially licensed professional WNBA product.",
          ],
        };
  }

  return {
    eligible: false,
    scope: "outside_growth_focus",
    reasons: [],
    rejectionReasons: [
      "Growth Specs are currently limited to licensed professional baseball and WNBA cards.",
    ],
  };
}
