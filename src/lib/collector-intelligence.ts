import type { UniversalInventoryItem } from "../modules/inventory";
import { STORE_BRAND_NAME } from "./legal";

export type CollectorTrendStatus =
  | "not_enough_data"
  | "needs_refresh"
  | "source_review";

export type CollectorSourceLink = {
  label: string;
  href: string;
  description: string;
};

export type CollectorPopulationReport = {
  label: string;
  detail: string;
  detectedCompany: string | null;
  detectedGrade: string | null;
  detectedCertNumber: string | null;
  links: CollectorSourceLink[];
};

export type CollectorVariantSignal = {
  label: string;
  value: string;
  confidence: "title_signal" | "needs_source_confirmation";
};

export type CollectorIntelligence = {
  trendStatus: CollectorTrendStatus;
  trendLabel: string;
  trendDetail: string;
  story: string;
  whatToWatch: string[];
  socialLinks: CollectorSourceLink[];
  marketLinks: CollectorSourceLink[];
  acquisitionLinks: CollectorSourceLink[];
  setBuilderLinks: CollectorSourceLink[];
  newsLinks: CollectorSourceLink[];
  populationReport: CollectorPopulationReport;
  variantSignals: CollectorVariantSignal[];
  exactMatchLabel: string;
  exactMatchDetail: string;
  lastUpdated: string;
};

const GRADING_LINKS: Record<string, CollectorSourceLink> = {
  PSA: {
    label: "PSA Cert Verification",
    href: "https://www.psacard.com/cert",
    description: "Verify PSA certification details directly with PSA.",
  },
  SGC: {
    label: "SGC Cert Lookup",
    href: "https://www.gosgc.com/cert-code-lookup",
    description: "Check SGC certification details directly with SGC.",
  },
  CGC: {
    label: "CGC Cert Lookup",
    href: "https://www.cgccards.com/certlookup/",
    description: "Check CGC certification details directly with CGC.",
  },
  BGS: {
    label: "Beckett Card Lookup",
    href: "https://www.beckett.com/grading/card-lookup",
    description: "Check Beckett/BGS grading details directly with Beckett.",
  },
};

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean) as string[];
}

function searchQuery(product: UniversalInventoryItem) {
  return compact([product.title, product.player, product.sport]).join(" ");
}

function encoded(value: string) {
  return encodeURIComponent(value);
}

function detectGradingCompany(title: string) {
  const normalized = title.toUpperCase();

  if (/\bPSA\b/.test(normalized)) return "PSA";
  if (/\bSGC\b/.test(normalized)) return "SGC";
  if (/\bCGC\b/.test(normalized)) return "CGC";
  if (/\bBGS\b|\bBECKETT\b/.test(normalized)) return "BGS";

  return null;
}

function detectGrade(title: string) {
  const gradeMatch =
    /\b(?:PSA|SGC|CGC|BGS|BECKETT)\s*(?:GEM\s*MINT|MINT|NM-MT|PRISTINE)?\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6)\b/i.exec(
      title,
    );

  return gradeMatch?.[1] || null;
}

function detectCertNumber(title: string) {
  const certMatch =
    /\b(?:cert|certificate|certification)\s*(?:#|number|no\.?)?\s*:?\s*([a-z0-9-]{5,})\b/i.exec(
      title,
    );

  return certMatch?.[1] || null;
}

function firstMatch(title: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(title);

    if (match?.[1]) return match[1].trim();
    if (match?.[0]) return match[0].trim();
  }

  return null;
}

function detectParallel(title: string) {
  const match = firstMatch(title, [
    /\b(pink|blue|green|gold|orange|red|purple|black|white|silver|sepia|aqua|teal|bronze|copper|camo)\s+(refractor|prizm|holo|parallel|wave|mojo|shimmer|scope|laser|disco)\b/i,
    /\b(refractor|x-fractor|xfractor|prizm|holo|holographic|optic|chrome|wave|mojo|cracked ice|shimmer|lava|scope|atomic|disco|laser|rainbow foil|negative|parallel)\b/i,
  ]);

  return match;
}

function buildVariantSignals(product: UniversalInventoryItem): CollectorVariantSignal[] {
  const title = product.title;
  const signals: CollectorVariantSignal[] = [];
  const serialNumber = firstMatch(title, [
    /\b(\d{1,5}\s*\/\s*\d{1,5})\b/,
    /\b(?:numbered|serial|s\/n)\s*(?:to|out of|\/)?\s*(\d{1,5})\b/i,
  ]);
  const cardNumber = firstMatch(title, [
    /(?:^|\s)#\s*([a-z0-9-]{1,12})\b/i,
    /\bcard\s*(?:#|number|no\.?)\s*([a-z0-9-]{1,12})\b/i,
  ]);
  const parallel = detectParallel(title);
  const autograph = /\b(auto|autograph|autographed|signature|signed)\b/i.test(title);
  const relic = /\b(relic|patch|jersey|memorabilia|swatch|rpa)\b/i.test(title);
  const rookie = /\b(rookie|rc)\b/i.test(title);
  const gradedCompany = detectGradingCompany(title);
  const grade = detectGrade(title);

  if (serialNumber) {
    signals.push({
      label: "Serial numbering",
      value: serialNumber.replaceAll(" ", ""),
      confidence: "title_signal",
    });
  }

  if (cardNumber) {
    signals.push({
      label: "Card number",
      value: cardNumber,
      confidence: "title_signal",
    });
  }

  if (parallel) {
    signals.push({
      label: "Parallel / finish",
      value: parallel,
      confidence: "needs_source_confirmation",
    });
  }

  if (autograph) {
    signals.push({
      label: "Autograph signal",
      value: "Autograph mentioned",
      confidence: "needs_source_confirmation",
    });
  }

  if (relic) {
    signals.push({
      label: "Relic / patch signal",
      value: "Relic or patch mentioned",
      confidence: "needs_source_confirmation",
    });
  }

  if (rookie) {
    signals.push({
      label: "Rookie signal",
      value: "Rookie or RC mentioned",
      confidence: "needs_source_confirmation",
    });
  }

  if (gradedCompany || grade) {
    signals.push({
      label: "Grade signal",
      value: compact([gradedCompany, grade ? `Grade ${grade}` : null]).join(" "),
      confidence: "needs_source_confirmation",
    });
  }

  return signals;
}

function buildPopulationReport(product: UniversalInventoryItem): CollectorPopulationReport {
  const company = detectGradingCompany(product.title);
  const grade = detectGrade(product.title);
  const certNumber = detectCertNumber(product.title);
  const links = company ? [GRADING_LINKS[company]] : Object.values(GRADING_LINKS);

  if (!company) {
    return {
      label: "Population report unavailable",
      detail:
        "No grading company was detected in this listing title. TCOS will not guess a population count.",
      detectedCompany: null,
      detectedGrade: null,
      detectedCertNumber: null,
      links,
    };
  }

  if (!certNumber) {
    return {
      label: `${company} grade detected`,
      detail:
        "A grading company was detected, but no cert number is stored for this product. Use the official lookup before treating the grade or population as verified.",
      detectedCompany: company,
      detectedGrade: grade,
      detectedCertNumber: null,
      links,
    };
  }

  return {
    label: `${company} cert ready for verification`,
    detail:
      "A cert number appears in the listing title. TCOS links to the official lookup, but public pop counts should only be shown after a saved source check.",
    detectedCompany: company,
    detectedGrade: grade,
    detectedCertNumber: certNumber,
    links,
  };
}

function buildStory(product: UniversalInventoryItem) {
  const identity = compact([product.player, product.sport]).join(" - ");

  if (identity) {
    return `${product.title} is tracked as ${identity}. TCOS can point collectors to market, news, and source checks, but it will not label this item as trending until verified source data supports it.`;
  }

  return `${product.title} is ready for collector research. TCOS can point buyers toward market and source checks, but it will not invent a trend without verified data.`;
}

function buildWhatToWatch(product: UniversalInventoryItem) {
  const watch = [
    "recent sold comps before making a pricing decision",
    "grading cert and population data when a cert number is available",
    "official news or source updates before showing a public trend badge",
  ];

  if (product.player || product.sport) {
    watch.unshift("player, team, season, award, injury, trade, or playoff news");
  }

  if (/pokemon|pokémon|charizard|pikachu|marvel|dc|spider|batman|superman|mario|sonic/i.test(product.title)) {
    watch.unshift("franchise, character, release, anniversary, or manufacturer news");
  }

  return watch;
}

function buildSetBuilderLinks(
  product: UniversalInventoryItem,
  storeDisplayName: string,
): CollectorSourceLink[] {
  const query = searchQuery(product);
  const playerQuery = compact([product.player, product.sport]).join(" ");
  const exactTitle = product.title;
  const checklistQuery = `${query} checklist`;
  const completeRunQuery = product.player
    ? `${product.player} ${product.sport || ""} cards`
    : `${exactTitle} related cards`;

  const links: CollectorSourceLink[] = [
    {
      label: "TCOS Exact Search",
      href: `/shop?q=${encoded(exactTitle)}`,
      description:
        `Search ${storeDisplayName} first for this exact title or nearby inventory matches.`,
    },
    {
      label: "TCOS Player/Category Run",
      href: `/shop?q=${encoded(playerQuery || exactTitle)}`,
      description:
        "Search TCOS for the player, category, character, or related run.",
    },
    {
      label: "eBay Set Builder Search",
      href: `https://www.ebay.com/sch/i.html?_nkw=${encoded(`${completeRunQuery} checklist set`)}`,
      description:
        "Look for missing set pieces, player-run cards, lots, and related listings.",
    },
    {
      label: "COMC Set Search",
      href: `https://www.google.com/search?q=${encoded(`site:comc.com ${checklistQuery}`)}`,
      description:
        "Search COMC pages for checklist, set, and inventory matches.",
    },
    {
      label: "Sportlots Set Search",
      href: `https://www.google.com/search?q=${encoded(`site:sportlots.com ${checklistQuery}`)}`,
      description:
        "Search Sportlots inventory and selling-history pages for set-builder targets.",
    },
    {
      label: "CollX Checklist Research",
      href: `https://www.google.com/search?q=${encoded(`site:collx.app ${checklistQuery}`)}`,
      description:
        "Search CollX research pages for checklist and catalog context.",
    },
    {
      label: "Manufacturer Checklist Search",
      href: `https://www.google.com/search?q=${encoded(`${checklistQuery} manufacturer checklist`)}`,
      description:
        "Find official or manufacturer-backed checklist references when available.",
    },
  ];

  if (product.player) {
    links.push({
      label: "130point Player Run Comps",
      href: `https://130point.com/sales/?search=${encoded(completeRunQuery)}`,
      description:
        "Review sold examples across a player run before deciding what to chase next.",
    });
  }

  return links;
}

export function buildCollectorIntelligence(
  product: UniversalInventoryItem,
  options: {
    storeDisplayName?: string | null;
  } = {},
): CollectorIntelligence {
  const storeDisplayName = options.storeDisplayName?.trim() || STORE_BRAND_NAME;
  const query = searchQuery(product);
  const titleQuery = product.title;
  const personOrItemQuery = compact([product.player, product.title])[0] || titleQuery;
  const variantSignals = buildVariantSignals(product);
  const exactMatchLabel =
    variantSignals.length > 0 ? "Needs Checklist Confirmation" : "No Variant Signals Detected";
  const exactMatchDetail =
    variantSignals.length > 0
      ? "TCOS found title-level signals that can help identify the exact card, but checklist/source evidence is still required before claiming the exact variation or parallel."
      : "TCOS did not detect serial numbering, card number, parallel, autograph, relic, rookie, or grade signals from the current title.";

  const socialLinks: CollectorSourceLink[] = [
    {
      label: "Search X",
      href: `https://x.com/search?q=${encoded(personOrItemQuery)}&src=typed_query`,
      description:
        "Look for public conversation around the player, item, team, character, or franchise.",
    },
  ];

  const marketLinks: CollectorSourceLink[] = [
    {
      label: "Search TCOS",
      href: `/shop?q=${encoded(query)}`,
      description: `Look for this or related items inside ${storeDisplayName} first.`,
    },
    {
      label: "eBay Active Search",
      href: `https://www.ebay.com/sch/i.html?_nkw=${encoded(query)}`,
      description: "Search active eBay listings for available comparable items.",
    },
    {
      label: "eBay Sold Search",
      href: `https://www.ebay.com/sch/i.html?_nkw=${encoded(query)}&LH_Sold=1&LH_Complete=1`,
      description: "Review completed eBay sales for comparable items.",
    },
    {
      label: "130point Sales Search",
      href: `https://130point.com/sales/?search=${encoded(query)}`,
      description: "Review sales comps where available through 130point.",
    },
  ];

  const acquisitionLinks: CollectorSourceLink[] = [
    {
      label: "COMC Search",
      href: `https://www.google.com/search?q=${encoded(`site:comc.com ${query}`)}`,
      description: "Search COMC listings and catalog pages for matching cards.",
    },
    {
      label: "Sportlots Search",
      href: `https://www.google.com/search?q=${encoded(`site:sportlots.com ${query}`)}`,
      description:
        "Search Sportlots inventory and selling-history pages for possible stock and pricing context.",
    },
    {
      label: "CollX Research",
      href: `https://www.google.com/search?q=${encoded(`site:collx.app ${query}`)}`,
      description: "Search CollX pages for possible catalog and value context.",
    },
    {
      label: "PriceCharting Search",
      href: `https://www.pricecharting.com/search-products?q=${encoded(query)}&type=prices`,
      description: "Search PriceCharting for pricing history when supported.",
    },
    {
      label: "SportsCardsPro Search",
      href: `https://www.sportscardspro.com/search-products?q=${encoded(query)}&type=prices`,
      description: "Search SportsCardsPro for sports-card pricing when supported.",
    },
    {
      label: "PSA Auction Prices",
      href: `https://www.psacard.com/auctionprices#q=${encoded(query)}`,
      description: "Search PSA auction-price references when relevant.",
    },
    {
      label: "Google Marketplace Search",
      href: `https://www.google.com/search?q=${encoded(`${query} buy card`)}`,
      description: "Look for other permitted sources when TCOS does not have the item.",
    },
  ];

  if (product.ebayItemId) {
    marketLinks.unshift({
      label: "eBay Listing",
      href: `https://www.ebay.com/itm/${encoded(product.ebayItemId)}`,
      description: "Open the synced eBay listing for this item.",
    });
  }

  const newsLinks: CollectorSourceLink[] = [
    {
      label: "Google News",
      href: `https://news.google.com/search?q=${encoded(query)}`,
      description:
        "Search current news before assigning any public trend or story claim.",
    },
    {
      label: "Google Source Search",
      href: `https://www.google.com/search?q=${encoded(`${query} official`)}`,
      description:
        "Find official player, team, manufacturer, grading, or franchise sources.",
    },
  ];

  return {
    trendStatus: "not_enough_data",
    trendLabel: "Not Enough Verified Data",
    trendDetail:
      "TCOS has not saved enough verified market, news, social, or population data to call this item trending yet.",
    story: buildStory(product),
    whatToWatch: buildWhatToWatch(product),
    socialLinks,
    marketLinks,
    acquisitionLinks,
    setBuilderLinks: buildSetBuilderLinks(product, storeDisplayName),
    newsLinks,
    populationReport: buildPopulationReport(product),
    variantSignals,
    exactMatchLabel,
    exactMatchDetail,
    lastUpdated: new Date().toISOString(),
  };
}
