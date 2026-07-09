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

export type InstaCompProviderSource =
  | "ebay_active"
  | "comc_active"
  | "tcos_inventory";

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
};

export type InstaCompStats = {
  low: number | null;
  median: number | null;
  average: number | null;
  high: number | null;
  suggestedPrice: number | null;
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

export function buildInstaCompQueries(ai: InstaCompAiResult) {
  const primaryParts = [
    cleanPart(ai.year),
    cleanPart(ai.brand),
    cleanPart(ai.setName),
    cleanPart(ai.player),
    ai.isRookie ? "rookie" : "",
    cleanPart(ai.parallel),
    ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
    cleanPart(ai.serialNumber),
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
      ai.cardNumber ? `#${cleanPart(ai.cardNumber).replace(/^#/, "")}` : "",
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

  return {
    ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=0&LH_Sold=1&LH_Complete=1`,
    ebayActiveUrl: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=0`,
    one30pointUrl: `https://130point.com/sales/?search=${encoded}`,
    comcUrl: `https://www.comc.com/Cards,sr,i100,=${plusEncoded}`,
    myslabsUrl: `https://myslabs.com/search?q=${encoded}`,
    pwccUrl: `https://www.pwccmarketplace.com/search?q=${encoded}`,
    goldinUrl: `https://goldin.co/search?q=${encoded}`,
    fanaticsUrl: `https://www.fanaticscollect.com/search?q=${encoded}`,
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
  const cardNumber = normalizeCardNumber(ai.cardNumber);

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

  if (parallel && t.includes(parallel)) {
    score += 15;
    flags.push("parallel");
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