import {
  extractInstaCompSerialNumber,
  serialRunDisplayLabel,
} from "./instacomp-serial";

export type InstaCompAiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
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
  currency: string;
  url: string;
  imageUrl: string | null;
  source: InstaCompProviderSource;
  sourceLabel: string;
  sourceCategory: InstaCompSourceCategory;
  matchScore: number;
  flags: string[];
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

function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return "";
  return String(value).toLowerCase().replace("#", "").trim();
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

function serialRunDenominator(value: string | null | undefined) {
  const serial = serialNumberParts(value);
  const denominator = Number(serial.denominator);

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function serialRunDenominatorFromTitle(title: string) {
  const normalized = normalizeText(title)
    .replace(/\bone\s+of\s+one\b/g, "1/1")
    .replace(/\b1\s+of\s+1\b/g, "1/1");
  const match =
    normalized.match(/(?:\d+\s*\/\s*|\/\s*|of\s+)(\d{1,4})(?!\d)/i) ||
    normalized.match(/numbered\s*(?:to|\/)\s*(\d{1,4})(?!\d)/i);
  const denominator = match ? Number(match[1]) : NaN;

  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function serialRunAdjustmentFactor(targetDenominator: number, compDenominator: number) {
  if (targetDenominator <= 0 || compDenominator <= 0) return 1;

  const raw = Math.sqrt(compDenominator / targetDenominator);

  return Math.max(0.4, Math.min(3, raw));
}

function isBaseParallel(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized === "base" || normalized === "base card";
}

function parallelTokens(value: string | null | undefined) {
  const normalized = normalizeText(value);

  if (!normalized || isBaseParallel(value)) return [];

  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
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
        ].includes(token)
    );
}

export function buildInstaCompQueries(ai: InstaCompAiResult) {
  const serialRun = serialRunSearchToken(ai.serialNumber);

  const primaryParts = [
    cleanPart(ai.year),
    cleanPart(ai.brand),
    cleanPart(ai.setName),
    cleanPart(ai.player),
    ai.isRookie ? "rookie" : "",
    cleanPart(ai.parallel),
    ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    serialRun,
  ].filter(Boolean);

  const primary = primaryParts.join(" ").replace(/\s+/g, " ").trim();

  const backupQueries = [
    [
      cleanPart(ai.player),
      cleanPart(ai.brand),
      cleanPart(ai.setName),
      ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      cleanPart(ai.player),
      cleanPart(ai.parallel),
      serialRun,
      ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [
      cleanPart(ai.player),
      cleanPart(ai.year),
      cleanPart(ai.brand),
      cleanPart(ai.parallel),
      serialRun,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),

    [cleanPart(ai.player), cleanPart(ai.year), cleanPart(ai.brand)]
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
    "collx.app",
    "cardbase.com",
    "stockx.com",
    "tcdb.com",
    "tradingcarddb.com",
    "cardboardconnection.com",
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
  const mercariUrl = `https://www.mercari.com/search/?keyword=${encoded}`;
  const facebookMarketplaceUrl = `https://www.facebook.com/marketplace/search/?query=${encoded}`;
  const googleShoppingUrl = `https://www.google.com/search?tbm=shop&q=${encoded}`;
  const broadCardMarketUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} (${broadSiteDomains})`)}`;

  const sourceDirectory: InstaCompSourceLink[] = [
    { label: "eBay Sold", url: ebaySoldUrl, category: "sold" },
    { label: "130point", url: one30pointUrl, category: "sold" },
    { label: "PSA APR", url: googleSiteUrl("psacard.com/auctionprices"), category: "sold" },
    { label: "eBay Active", url: ebayActiveUrl, category: "marketplace" },
    { label: "COMC", url: comcUrl, category: "marketplace" },
    { label: "MySlabs", url: myslabsUrl, category: "marketplace" },
    { label: "Sportlots", url: sportlotsUrl, category: "marketplace" },
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
    { label: "CollX", url: googleSiteUrl("collx.app"), category: "pricing" },
    { label: "Cardbase", url: googleSiteUrl("cardbase.com"), category: "pricing" },
    { label: "TCDB", url: googleSiteUrl("tcdb.com"), category: "reference" },
    { label: "Trading Card DB", url: googleSiteUrl("tradingcarddb.com"), category: "reference" },
    { label: "Cardboard Connection", url: googleSiteUrl("cardboardconnection.com"), category: "reference" },
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

  if (ai && !ai.conditionGuess?.toLowerCase().includes("graded")) {
    if (containsAny(` ${t} `, gradedWords)) return true;
  }

  if (ai && !ai.isAuto) {
    if (containsAny(` ${t} `, [" auto ", " autograph", " signed"])) {
      return true;
    }
  }

  if (ai && !ai.isRelic) {
    if (containsAny(t, [" relic", " patch", " jersey", " memorabilia"])) {
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
  const year = normalizeText(ai.year);
  const brand = normalizeText(ai.brand);
  const setName = normalizeText(ai.setName);
  const parallel = normalizeText(ai.parallel);
  const parallelTokenList = parallelTokens(ai.parallel);
  const cardNumber = normalizeCardNumber(ai.cardNumber);
  const serial = serialNumberParts(ai.serialNumber);

  if (player && t.includes(player)) {
    score += 30;
    flags.push("player");
  }

  if (year && t.includes(year)) {
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
  }

  if (cardNumber) {
    const padded = ` ${t} `;

    const patterns = [
      `#${cardNumber}`,
      ` ${cardNumber} `,
      `-${cardNumber} `,
      `/${cardNumber} `,
      ` no ${cardNumber} `,
      ` number ${cardNumber} `,
      ` card ${cardNumber} `,
    ];

    if (patterns.some((pattern) => padded.includes(pattern))) {
      score += 25;
      flags.push("card #");
    }
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

  if (serial.normalized) {
    const compactTitle = t.replace(/\s+/g, "");
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

  if (ai.isRookie && containsAny(` ${t} `, [" rookie ", " rc "])) {
    score += 8;
    flags.push("rookie");
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
        (!requiresPlayerEvidence || comp.flags.includes("player")) &&
        (!requiresCardNumberEvidence || comp.flags.includes("card #"))
    )
    .filter(
      (comp) =>
        !requiresParallelEvidence ||
        comp.flags.includes("parallel") ||
        comp.flags.includes("parallel partial")
    )
    .filter((comp) => {
      if (!targetDenominator) return true;

      return serialRunDenominatorFromTitle(comp.title) === targetDenominator;
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
