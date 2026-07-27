import {
  extractInstaCompSerialNumber,
  serialRunDisplayLabel,
} from "./instacomp-serial";
import {
  cleanCertificationNumber,
  gradingSearchPart,
  normalizeGradingCompany,
} from "./grading-cert";

export type InstaCompAiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  certificationNumber?: string | null;
  certificationLookupUrl?: string | null;
  gradingEvidence?: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

export type InstaCompProviderSource = string;

export type InstaCompProviderStatus =
  | "live"
  | "not_configured"
  | "error"
  | "no_matches";

export type InstaCompComp = {
  title: string;
  price: number;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  priceIncludesShipping?: boolean;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: InstaCompProviderSource;
  sourceLabel: string;
  sourceCategory: InstaCompSourceCategory;
  matchScore: number;
  flags: string[];
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

export type InstaCompProviderResult = {
  source: InstaCompProviderSource;
  label: string;
  status: InstaCompProviderStatus;
  message: string | null;
  results: InstaCompComp[];
  searchUrl?: string;
  diagnostics?: {
    externalSearch?: {
      provider: "serpapi" | "google_cse" | null;
      providerLabel: string | null;
      cacheStatus:
        | "hit"
        | "miss"
        | "disabled"
        | "not_configured"
        | "error";
      cacheHit: boolean;
      externalRequestAttempted: boolean;
      paidSearchUsed: boolean;
      requestedLimit: number;
      returnedSearchItems: number;
      includedCompCount: number;
      registeredSourceCount: number;
      cacheTtlDays: number;
      cacheExpiresAt: string | null;
      cacheHitCountBeforeScan: number | null;
    };
  };
};

export type InstaCompStats = {
  low: number | null;
  median: number | null;
  average: number | null;
  high: number | null;
  suggestedPrice: number | null;
};

export type InstaCompSourceCategory =
  | "sold"
  | "marketplace"
  | "auction"
  | "pricing"
  | "reference"
  | "broad";

export type InstaCompSourceLink = {
  label: string;
  url: string;
  category: InstaCompSourceCategory;
};

export type InstaCompSourceCoverage = {
  label: string;
  category: InstaCompSourceCategory;
  status: "included" | "registered" | "not_configured" | "no_matches" | "error";
  includedInMarketValue: boolean;
  resultCount: number;
  message: string | null;
};

export type InstaCompLinks = {
  ebaySoldUrl: string;
  ebayActiveUrl: string;
  one30pointUrl: string;
  comcUrl: string;
  myslabsUrl: string;
  pwccUrl: string;
  goldinUrl: string;
  fanaticsUrl: string;
  sportlotsUrl: string;
  mercariUrl: string;
  facebookMarketplaceUrl: string;
  googleShoppingUrl: string;
  broadCardMarketUrl: string;
  sourceDirectory: InstaCompSourceLink[];
};

function cleanPart(value: string | null | undefined) {
  if (!value) return "";

  return value
    .replace(/\s+/g, " ")
    .replace(/[^\w\s#./&+-]/g, "")
    .trim();
}

function normalizeText(value: string | null | undefined) {
  return cleanPart(value)
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/\brookie card\b/g, "rookie")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function meaningfulTokens(value: string | null | undefined) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "card",
          "cards",
          "trading",
          "basketball",
          "hockey",
          "baseball",
          "football",
          "level",
          "series",
          "set",
          "panini",
          "upper",
          "deck",
        ].includes(token)
    );
}

function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return "";
  return String(value).toLowerCase().replace("#", "").trim();
}

function stripSeasonRanges(value: string) {
  return String(value || "").replace(
    /\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g,
    " ",
  );
}

function canonicalSeason(value: string | null | undefined) {
  const normalized = normalizeText(value);
  const match = normalized.match(
    /\b((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b/,
  );
  if (!match) return normalized;
  const start = match[1];
  const rawEnd = match[2];
  const end = rawEnd.length === 2 ? `${start.slice(0, 2)}${rawEnd}` : rawEnd;
  return `${start}-${end}`;
}

function titleHasYear(title: string, value: string | null | undefined) {
  const target = canonicalSeason(value);
  if (!target) return false;
  if (/^(?:19|20)\d{2}$/.test(target)) {
    return new RegExp(`(?:^|[^0-9])${target}(?:$|[^0-9])`).test(
      normalizeText(title),
    );
  }
  return canonicalSeason(title) === target;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleHasExactCardNumber(
  title: string,
  value: string | null | undefined,
) {
  const cardNumber = normalizeCardNumber(value);
  if (!cardNumber) return false;

  const flexible = escapeRegex(cardNumber).replace(/\\-/g, "[-\\s]?");
  const explicit = new RegExp(
    `(?:#|card\\s*(?:no\\.?|number)?|no\\.?)\\s*${flexible}(?![a-z0-9])`,
    "i",
  );
  if (explicit.test(title)) return true;

  const stripped = stripSeasonRanges(normalizeText(title));
  if (/[a-z]/i.test(cardNumber)) {
    return new RegExp(`(?:^|[^a-z0-9])${flexible}(?:$|[^a-z0-9])`, "i").test(
      stripped,
    );
  }

  const number = Number(cardNumber);
  if (!Number.isFinite(number) || number <= 10) return false;
  return new RegExp(`(?:^|[^0-9])${escapeRegex(cardNumber)}(?:$|[^0-9])`).test(
    stripped,
  );
}

function numericGrade(value: string | null | undefined) {
  const match = String(value || "").match(/\b(10|[0-9](?:\.[0-9])?)\b/);
  return match ? Number(match[1]) : null;
}

function graderGradesFromTitle(title: string, grader: string) {
  if (!grader) return [] as number[];
  const normalizedTitle = normalizeText(title);
  const graderPattern = escapeRegex(grader).replace(/\\s+/g, "\\s*");
  const pattern = new RegExp(
    `(?:^|\\s)${graderPattern}\\s*(?:(?:gem|near|nm|mint|pristine)\\s*)*(10|[0-9](?:\\.[0-9])?)\\b`,
    "gi",
  );
  return Array.from(normalizedTitle.matchAll(pattern))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function normalizeSerialNumber(value: string | null | undefined) {
  if (!value) return "";

  return String(value)
    .toLowerCase()
    .replace(/\bone\s+of\s+one\b/g, "1/1")
    .replace(/\b1\s+of\s+1\b/g, "1/1")
    .replace(/\s+/g, "")
    .trim();
}

function serialNumberParts(value: string | null | undefined) {
  const normalized = normalizeSerialNumber(value);
  const parsed = extractInstaCompSerialNumber(normalized);

  if (!parsed) {
    return {
      normalized: "",
      numerator: "",
      denominator: "",
      unpadded: "",
    };
  }

  const numerator = String(parsed.numerator);
  const denominator = String(parsed.denominator);

  return {
    normalized: parsed.exact.toLowerCase(),
    numerator,
    denominator,
    unpadded: `${numerator}/${denominator}`,
  };
}

function serialRunSearchToken(value: string | null | undefined) {
  return serialRunDisplayLabel(value) || "";
}

function certificationNumberSearchToken(value: string | null | undefined) {
  const cert = cleanCertificationNumber(value);

  return cert ? `cert ${cert}` : "";
}

function serialRunDenominator(value: string | null | undefined) {
  const serial = serialNumberParts(value);
  const denominator = Number(serial.denominator);

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function serialRunDenominatorFromTitle(title: string) {
  const normalized = stripSeasonRanges(
    normalizeText(title)
      .replace(/\bone\s+of\s+one\b/g, "1/1")
      .replace(/\b1\s+of\s+1\b/g, "1/1"),
  );
  const parsed = extractInstaCompSerialNumber(normalized);
  const denominator = Number(parsed?.denominator);

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function serialRunAdjustmentFactor(targetDenominator: number, compDenominator: number) {
  if (targetDenominator <= 0 || compDenominator <= 0) return 1;

  const raw = Math.sqrt(compDenominator / targetDenominator);

  return Math.max(0.4, Math.min(3, raw));
}

function normalizedParallelDescriptor(value: string | null | undefined) {
  let normalized = normalizeText(value).replace(/\s*&\s*/g, " and ");
  if (!normalized || isUncertainParallel(value)) return "";

  normalized = normalized
    .replace(/\b(?:serial(?:ly)?[-\s]?numbered|numbered)\b(?:\s*(?:to|\/))?\s*\d{1,6}\b/g, " ")
    .replace(/\b\d{1,6}\s*\/\s*\d{1,6}\b/g, " ")
    .replace(/(?:^|\s)\/\s*\d{1,6}\b/g, " ")
    .replace(/\bbase\b/g, " ")
    .replace(/\b(?:memorabilia|relic|autograph|auto)\s+issue\b/g, " ")
    .replace(/\bissue\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (["standard", "standard card", "regular", "regular card", "card"].includes(normalized)) {
    return "";
  }
  return normalized;
}

export function normalizeInstaCompParallelForExactMatching(
  value: string | null | undefined,
) {
  return normalizedParallelDescriptor(value);
}

function isBaseParallel(value: string | null | undefined) {
  return normalizedParallelDescriptor(value) === "";
}

function isUncertainParallel(value: string | null | undefined) {
  return /\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\b/i.test(
    String(value || ""),
  );
}

function searchParallelPart(value: string | null | undefined) {
  const normalized = normalizedParallelDescriptor(value);
  return normalized ? cleanPart(normalized) : "";
}

function parallelTokens(value: string | null | undefined) {
  const normalized = normalizedParallelDescriptor(value);
  if (!normalized) return [];

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[a-z0-9]+$/.test(token))
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "parallel",
          "exact",
          "type",
          "uncertain",
          "version",
          "card",
          "and",
        ].includes(token),
    );
  const distinctive = tokens.filter(
    (token) => !["prizm", "refractor", "foil", "holo"].includes(token),
  );
  return distinctive.length ? distinctive : tokens;
}

const PARALLEL_COLOR_TOKENS = [
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "yellow",
  "teal",
  "aqua",
  "bronze",
  "copper",
] as const;

function titleHasWholeToken(title: string, token: string) {
  return new RegExp(`(?:^|[^a-z0-9])${token}(?:$|[^a-z0-9])`, "i").test(title);
}

export function explainInstaCompParallelMismatch(
  title: string,
  targetParallel: string | null | undefined,
) {
  const requiredTokens = parallelTokens(targetParallel);
  if (!requiredTokens.length) return null;

  const normalizedTitle = normalizeText(title);
  const targetColors = requiredTokens.filter((token) =>
    PARALLEL_COLOR_TOKENS.includes(token as (typeof PARALLEL_COLOR_TOKENS)[number]),
  );
  const listingColors = PARALLEL_COLOR_TOKENS.filter((token) =>
    titleHasWholeToken(normalizedTitle, token),
  );
  const conflictingColors = listingColors.filter(
    (token) => !targetColors.includes(token),
  );
  const expected = cleanPart(targetParallel) || "the identified parallel";

  if (conflictingColors.length) {
    return `parallel mismatch: expected ${expected}; listing says ${conflictingColors.join("/")}`;
  }

  const missingTokens = requiredTokens.filter(
    (token) => !titleHasWholeToken(normalizedTitle, token),
  );
  if (!missingTokens.length) return null;

  return `parallel mismatch: expected ${expected}; missing ${missingTokens.join(" ")}`;
}

export function buildInstaCompQueries(ai: InstaCompAiResult) {
  const serialRun = serialRunSearchToken(ai.serialNumber);
  const parallelPart = searchParallelPart(ai.parallel);
  const gradePart = gradingSearchPart(ai);
  const certPart = certificationNumberSearchToken(ai.certificationNumber);

  const primaryParts = [
    gradePart,
    cleanPart(ai.year),
    cleanPart(ai.brand),
    cleanPart(ai.setName),
    cleanPart(ai.player),
    ai.isRookie ? "rookie" : "",
    parallelPart,
    ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    serialRun,
  ].filter(Boolean);

  const primary = primaryParts.join(" ").replace(/\s+/g, " ").trim();

  const backupQueries = [
    [
      gradePart,
      cleanPart(ai.player),
      cleanPart(ai.year),
      cleanPart(ai.brand),
      certPart,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      gradePart,
      cleanPart(ai.player),
      cleanPart(ai.setName),
      certPart,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      gradePart,
      cleanPart(ai.player),
      cleanPart(ai.brand),
      cleanPart(ai.setName),
      ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      gradePart,
      cleanPart(ai.player),
      parallelPart,
      serialRun,
      ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      gradePart,
      cleanPart(ai.player),
      cleanPart(ai.year),
      cleanPart(ai.brand),
      parallelPart,
      serialRun,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [gradePart, cleanPart(ai.player), cleanPart(ai.year), cleanPart(ai.brand)]
      .filter(Boolean)
      .join(" ")
      .trim(),
  ].filter((q, index, arr) => q && arr.indexOf(q) === index);

  return {
    primary: primary || backupQueries[0] || cleanPart(ai.player) || "sports card",
    backupQueries,
  };
}

export function buildCompLinks(query: string): InstaCompLinks {
  const encoded = encodeURIComponent(query);
  const plusEncoded = encodeURIComponent(query).replace(/%20/g, "+");
  const broadSiteDomains = [
    "ebay.com",
    "130point.com",
    "comc.com",
    "sportlots.com",
    "mercari.com",
    "facebook.com/marketplace",
    "myslabs.com",
    "pwccmarketplace.com",
    "goldin.co",
    "fanaticscollect.com",
    "ha.com",
    "robertedwardauctions.com",
    "lelands.com",
    "pristineauction.com",
    "memorylaneinc.com",
    "sothebys.com",
    "christies.com",
    "whatnot.com",
    "alt.xyz",
    "cardladder.com",
    "sportscardinvestor.com",
    "psacard.com",
    "beckett.com",
    "pricecharting.com",
    "sportscardspro.com",
    "collx.app",
    "cardbase.com",
    "stockx.com",
    "tcdb.com",
    "tradingcarddb.com",
    "cardboardconnection.com",
    "blowoutcards.com",
    "blowoutforums.com",
  ]
    .map((site) => `site:${site}`)
    .join(" OR ");
  const googleSiteUrl = (domain: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${query}`)}`;

  const ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=0&LH_Sold=1&LH_Complete=1`;
  const ebayActiveUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=0`;
  const one30pointUrl = `https://130point.com/sales/?search=${encoded}`;
  const comcUrl = `https://www.comc.com/Cards,sr,i100,=${plusEncoded}`;
  const myslabsUrl = `https://myslabs.com/search?q=${encoded}`;
  const pwccUrl = `https://www.pwccmarketplace.com/search?q=${encoded}`;
  const goldinUrl = `https://goldin.co/search?q=${encoded}`;
  const fanaticsUrl = `https://www.fanaticscollect.com/search?q=${encoded}`;
  const sportlotsUrl = googleSiteUrl("sportlots.com");
  const paniniAmericaUrl = googleSiteUrl("paniniamerica.net");
  const upperDeckUrl = googleSiteUrl("upperdeck.com");
  const sportsCardsProUrl = `https://www.sportscardspro.com/search-products?q=${encoded}&type=prices`;
  const mercariUrl = `https://www.mercari.com/search/?keyword=${encoded}`;
  const facebookMarketplaceUrl = `https://www.facebook.com/marketplace/search/?query=${encoded}`;
  const googleShoppingUrl = `https://www.google.com/search?tbm=shop&q=${encoded}`;
  const broadCardMarketUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} (${broadSiteDomains})`)}`;

  const sourceDirectory: InstaCompSourceLink[] = [
    { label: "eBay Sold", url: ebaySoldUrl, category: "sold" },
    { label: "130point", url: one30pointUrl, category: "sold" },
    { label: "PSA APR", url: googleSiteUrl("psacard.com/auctionprices"), category: "sold" },
    { label: "eBay Active", url: ebayActiveUrl, category: "marketplace" },
    { label: "MySlabs", url: myslabsUrl, category: "marketplace" },
    { label: "Mercari", url: mercariUrl, category: "marketplace" },
    { label: "Facebook Marketplace", url: facebookMarketplaceUrl, category: "marketplace" },
    { label: "Whatnot", url: googleSiteUrl("whatnot.com"), category: "marketplace" },
    { label: "StockX", url: googleSiteUrl("stockx.com"), category: "marketplace" },
    { label: "Fanatics Collect", url: fanaticsUrl, category: "auction" },
    { label: "PWCC", url: pwccUrl, category: "auction" },
    { label: "Goldin", url: goldinUrl, category: "auction" },
    { label: "Heritage", url: googleSiteUrl("ha.com"), category: "auction" },
    { label: "REA", url: googleSiteUrl("robertedwardauctions.com"), category: "auction" },
    { label: "Lelands", url: googleSiteUrl("lelands.com"), category: "auction" },
    { label: "Pristine Auction", url: googleSiteUrl("pristineauction.com"), category: "auction" },
    { label: "Memory Lane", url: googleSiteUrl("memorylaneinc.com"), category: "auction" },
    { label: "Sotheby's", url: googleSiteUrl("sothebys.com"), category: "auction" },
    { label: "Christie's", url: googleSiteUrl("christies.com"), category: "auction" },
    { label: "Alt", url: googleSiteUrl("alt.xyz"), category: "pricing" },
    { label: "Card Ladder", url: googleSiteUrl("cardladder.com"), category: "pricing" },
    { label: "Market Movers", url: googleSiteUrl("sportscardinvestor.com"), category: "pricing" },
    { label: "Beckett", url: googleSiteUrl("beckett.com"), category: "pricing" },
    { label: "PriceCharting", url: googleSiteUrl("pricecharting.com"), category: "pricing" },
    { label: "SportsCardsPro Guide", url: sportsCardsProUrl, category: "pricing" },
    { label: "CollX", url: googleSiteUrl("collx.app"), category: "pricing" },
    { label: "Cardbase", url: googleSiteUrl("cardbase.com"), category: "pricing" },
    { label: "COMC Checklist", url: comcUrl, category: "reference" },
    { label: "Sportlots Checklist", url: sportlotsUrl, category: "reference" },
    { label: "Panini America Checklist", url: paniniAmericaUrl, category: "reference" },
    { label: "Upper Deck Checklist", url: upperDeckUrl, category: "reference" },
    { label: "TCDB", url: googleSiteUrl("tcdb.com"), category: "reference" },
    { label: "Trading Card DB", url: googleSiteUrl("tradingcarddb.com"), category: "reference" },
    { label: "Cardboard Connection", url: googleSiteUrl("cardboardconnection.com"), category: "reference" },
    { label: "Blowout Cards Checklist", url: googleSiteUrl("blowoutcards.com"), category: "reference" },
    { label: "Blowout Forums Reference", url: googleSiteUrl("blowoutforums.com"), category: "reference" },
    { label: "Google Shopping", url: googleShoppingUrl, category: "broad" },
    { label: "Broad Card Market", url: broadCardMarketUrl, category: "broad" },
  ];

  return {
    ebaySoldUrl,
    ebayActiveUrl,
    one30pointUrl,
    comcUrl,
    myslabsUrl,
    pwccUrl,
    goldinUrl,
    fanaticsUrl,
    sportlotsUrl,
    mercariUrl,
    facebookMarketplaceUrl,
    googleShoppingUrl,
    broadCardMarketUrl,
    sourceDirectory,
  };
}

export function looksLikeBadCompTitle(title: string, ai?: InstaCompAiResult) {
  const t = normalizeText(title);

  const alwaysBad = [
    "lot of",
    "pick your",
    "choose your",
    "custom",
    "reprint",
    "digital",
    "break",
    "case break",
    "box break",
    "team lot",
    "player lot",
    "read description",
    "facsimile",
    "proxy",
    "replica",
  ];

  if (containsAny(t, alwaysBad)) return true;

  const gradedWords = [
    " psa ",
    " bgs ",
    " sgc ",
    " cgc ",
    " tag ",
    " gem mint ",
    " mint 10",
    " graded",
    " slab",
  ];

  if (
    ai &&
    !normalizeGradingCompany(ai.gradingCompany) &&
    !ai.gradeValue &&
    !ai.conditionGuess?.toLowerCase().includes("graded")
  ) {
    if (containsAny(` ${t} `, gradedWords)) return true;
  }

  if (ai && !ai.isAuto) {
    if (containsAny(` ${t} `, [" auto ", " autograph", " signed"])) {
      return true;
    }
  }

  if (ai && !ai.isRelic) {
    if (containsAny(t, [" relic", " patch", " jersey", " memorabilia", " swatch", " material"])) {
      return true;
    }
  }

  return false;
}

export function scoreCompMatch(title: string, ai: InstaCompAiResult) {
  const t = normalizeText(title);
  const flags: string[] = [];
  let score = 0;

  const player = normalizeText(ai.player);
  const year = canonicalSeason(ai.year);
  const brand = normalizeText(ai.brand);
  const setName = normalizeText(ai.setName);
  const setTokens = meaningfulTokens(ai.setName);
  const parallel = normalizeText(ai.parallel);
  const parallelTokenList = parallelTokens(ai.parallel);
  const cardNumber = normalizeCardNumber(ai.cardNumber);
  const serial = serialNumberParts(ai.serialNumber);
  const grader = normalizeText(normalizeGradingCompany(ai.gradingCompany));
  const grade = normalizeText(ai.gradeValue);
  const certificationNumber = cleanCertificationNumber(ai.certificationNumber);
  const parallelMismatch = explainInstaCompParallelMismatch(title, ai.parallel);

  if (player && t.includes(player)) {
    score += 30;
    flags.push("player");
  }

  if (year && titleHasYear(title, ai.year)) {
    score += 15;
    flags.push("year");
  }

  if (brand && t.includes(brand)) {
    score += 15;
    flags.push("brand");
  }

  if (setName && t.includes(setName)) {
    score += 15;
    flags.push("set");
  } else if (setTokens.length) {
    const matchedSetTokens = setTokens.filter((token) =>
      containsAny(` ${t} `, [` ${token} `, `-${token} `, `/${token} `])
    );

    if (matchedSetTokens.length >= Math.min(3, setTokens.length)) {
      score += Math.min(12, matchedSetTokens.length * 4);
      flags.push("set partial");
    }
  }

  if (cardNumber && titleHasExactCardNumber(title, ai.cardNumber)) {
    score += 25;
    flags.push("card #");
  }

  if (parallel && !isBaseParallel(ai.parallel)) {
    if (t.includes(parallel)) {
      score += 22;
      flags.push("parallel");
    } else if (parallelTokenList.length) {
      const matchedTokens = parallelTokenList.filter((token) =>
        containsAny(` ${t} `, [` ${token} `, `-${token} `, `/${token} `])
      );

      if (matchedTokens.length >= Math.min(2, parallelTokenList.length)) {
        score += Math.min(18, matchedTokens.length * 6);
        flags.push("parallel partial");
      }
    }
  }

  if (parallelMismatch) {
    score -= 150;
    flags.push(parallelMismatch);
    flags.push("not exact parallel");
  }

  if (serial.normalized) {
    const compactTitle = stripSeasonRanges(t).replace(/\s+/g, "");
    const exactSerialPatterns = [
      serial.normalized,
      serial.unpadded,
      serial.normalized.replace("/", "of"),
      serial.unpadded.replace("/", "of"),
    ].filter(Boolean);

    if (exactSerialPatterns.some((pattern) => compactTitle.includes(pattern))) {
      score += 30;
      flags.push("serial #");
    } else if (
      serial.denominator &&
      containsAny(compactTitle, [
        `/${serial.denominator}`,
        `of${serial.denominator}`,
        `numberedto${serial.denominator}`,
        `numbered/${serial.denominator}`,
      ])
    ) {
      score += 14;
      flags.push("numbered run");
    }
  }

  if (grader && containsAny(` ${t} `, [` ${grader} `, `${grader} `])) {
    score += 20;
    flags.push("grader");
  }

  if (grade) {
    const targetGrade = numericGrade(ai.gradeValue);
    const visibleGrades = graderGradesFromTitle(title, grader);
    if (
      targetGrade !== null &&
      visibleGrades.some((visibleGrade) => visibleGrade === targetGrade)
    ) {
      score += 20;
      flags.push("grade");
    } else if (targetGrade !== null && visibleGrades.length) {
      score -= 150;
      flags.push(
        `grade mismatch: expected ${cleanPart(ai.gradingCompany)} ${cleanPart(
          ai.gradeValue,
        )}; listing says ${cleanPart(ai.gradingCompany)} ${visibleGrades.join("/")}`,
      );
    }
  }

  if (certificationNumber) {
    const compactTitle = t.replace(/[^a-z0-9]/g, "").toUpperCase();
    const compactCert = certificationNumber.replace(/[^A-Z0-9]/g, "");

    if (compactCert && compactTitle.includes(compactCert)) {
      score += 35;
      flags.push("cert #");
    }
  }

  if (ai.isRookie && containsAny(` ${t} `, [" rookie ", " rc "])) {
    score += 8;
    flags.push("rookie");
  }

  if (
    ai.isAuto &&
    containsAny(` ${t} `, [" auto ", " autograph ", " autographed ", " signed "])
  ) {
    score += 12;
    flags.push("autograph");
  }

  if (
    ai.isRelic &&
    containsAny(` ${t} `, [" relic ", " patch ", " jersey ", " memorabilia ", " swatch ", " swatches ", " material ", " materials "])
  ) {
    score += 12;
    flags.push("relic");
  }

  if (looksLikeBadCompTitle(title, ai)) {
    score -= 100;
    flags.push("excluded");
  }

  return {
    score,
    flags,
  };
}

export function filterAndRankExactMatches(
  comps: Omit<InstaCompComp, "matchScore" | "flags">[],
  ai: InstaCompAiResult,
  limit = 3,
  minScore = 45
): InstaCompComp[] {
  const targetDenominator = serialRunDenominator(ai.serialNumber);
  const requiresParallelEvidence = parallelTokens(ai.parallel).length > 0;
  const requiresPlayerEvidence = Boolean(normalizeText(ai.player));
  const requiresCardNumberEvidence = Boolean(normalizeCardNumber(ai.cardNumber));
  const requiresYearEvidence = Boolean(normalizeText(ai.year));
  const requiresBrandOrSetEvidence = Boolean(
    normalizeText(ai.brand) || normalizeText(ai.setName),
  );
  const setCanReplaceBrandEvidence = meaningfulTokens(ai.setName).length >= 2;
  const requiresAutographEvidence = ai.isAuto;
  const requiresRelicEvidence = ai.isRelic;
  const requiresGraderEvidence = Boolean(normalizeGradingCompany(ai.gradingCompany));
  const requiresGradeEvidence = Boolean(ai.gradeValue);

  return comps
    .map((comp) => {
      const scored = scoreCompMatch(comp.title, ai);

      return {
        ...comp,
        matchScore: scored.score,
        flags: scored.flags,
      };
    })
    .filter((comp) => comp.price > 0)
    .filter((comp) => !comp.flags.includes("excluded"))
    .filter(
      (comp) =>
        !comp.flags.some(
          (flag) =>
            flag.startsWith("parallel mismatch:") ||
            flag.startsWith("grade mismatch:"),
        ),
    )
    .filter(
      (comp) =>
        (!requiresPlayerEvidence || comp.flags.includes("player")) &&
        (!requiresCardNumberEvidence || comp.flags.includes("card #")) &&
        (!requiresYearEvidence || comp.flags.includes("year")) &&
        (!requiresBrandOrSetEvidence ||
          comp.flags.includes("brand") ||
          (setCanReplaceBrandEvidence && comp.flags.includes("set")) ||
          comp.flags.includes("set partial")) &&
        (!requiresAutographEvidence || comp.flags.includes("autograph")) &&
        (!requiresRelicEvidence || comp.flags.includes("relic")) &&
        (!requiresGraderEvidence || comp.flags.includes("grader")) &&
        (!requiresGradeEvidence || comp.flags.includes("grade"))
    )
    .filter(
      (comp) =>
        !requiresParallelEvidence ||
        comp.flags.includes("parallel") ||
        comp.flags.includes("parallel partial")
    )
    .filter((comp) => {
      const compDenominator = serialRunDenominatorFromTitle(comp.title);
      if (targetDenominator) return compDenominator === targetDenominator;
      return compDenominator === null;
    })
    .filter((comp) => comp.matchScore >= minScore)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.price - b.price;
    })
    .slice(0, limit);
}

export function filterAndRankGuidanceMatches(
  comps: Omit<InstaCompComp, "matchScore" | "flags">[],
  ai: InstaCompAiResult,
  limit = 8,
  minScore = 30
): InstaCompComp[] {
  const targetDenominator = serialRunDenominator(ai.serialNumber);

  return comps
    .map((comp) => {
      const scored = scoreCompMatch(comp.title, ai);
      const flags = new Set(scored.flags);
      flags.add("guidance comp");
      const compDenominator = serialRunDenominatorFromTitle(comp.title);
      const canAdjustForPricing = Boolean(targetDenominator && compDenominator);
      let price = comp.price;
      let sourceCategory: InstaCompSourceCategory = "reference";

      if (canAdjustForPricing && targetDenominator && compDenominator) {
        const factor = serialRunAdjustmentFactor(
          targetDenominator,
          compDenominator
        );
        price = roundMoney(comp.price * factor) || comp.price;
        sourceCategory = "pricing";
        flags.add(
          compDenominator === targetDenominator
            ? `same print run /${targetDenominator}`
            : `serial adjusted from /${compDenominator} to /${targetDenominator}`
        );
      } else {
        flags.add("not used for pricing");
      }

      return {
        ...comp,
        price,
        sourceCategory,
        matchScore: scored.score,
        flags: Array.from(flags),
      };
    })
    .filter((comp) => comp.price > 0)
    .filter((comp) => !comp.flags.includes("excluded"))
    .filter((comp) => comp.matchScore >= minScore)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.price - b.price;
    })
    .slice(0, limit);
}

export function calculateCompStats(comps: InstaCompComp[]): InstaCompStats {
  const prices = comps
    .map((comp) => comp.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (!prices.length) {
    return {
      low: null,
      median: null,
      average: null,
      high: null,
      suggestedPrice: null,
    };
  }

  const low = prices[0];
  const high = prices[prices.length - 1];
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;

  const middle = Math.floor(prices.length / 2);

  const median =
    prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];

  const suggestedPrice = roundMoney(median || average);

  return {
    low: roundMoney(low),
    median: roundMoney(median),
    average: roundMoney(average),
    high: roundMoney(high),
    suggestedPrice,
  };
}

export function roundMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;

  return Math.round(value * 100) / 100;
}
