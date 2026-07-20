export type MarketIntelSourceAccessMode =
  | "approved_api"
  | "approved_import"
  | "manual_research"
  | "unsupported";

export type MarketIntelSourceStatus =
  | "live_api"
  | "import"
  | "manual_research"
  | "access_needed"
  | "paused"
  | "error";

export type MarketIntelSourceCapability =
  | "live"
  | "manual"
  | "planned"
  | "none";

export type MarketIntelSourceUsagePolicy =
  | "valuation_and_bargain_discovery"
  | "price_guide_research_only"
  | "bargain_discovery_only";

export type MarketIntelSourceDefinition = {
  slug:
    | "ebay"
    | "sportscardspro"
    | "etsy"
    | "sportlots"
    | "mercari"
    | "facebook_marketplace"
    | "blowout_forums";
  displayName: string;
  accessMode: MarketIntelSourceAccessMode;
  status: MarketIntelSourceStatus;
  statusLabel: string;
  usagePolicy: MarketIntelSourceUsagePolicy;
  soldCompValuationAllowed: boolean;
  automatedSearchEnabled: boolean;
  activeListingSupport: MarketIntelSourceCapability;
  soldHistorySupport: MarketIntelSourceCapability;
  imageSupport: MarketIntelSourceCapability;
  checklistSupport: MarketIntelSourceCapability;
  directLinkSupport: boolean;
  authorizationStatus: string;
  rateLimitNotes: string;
  warnings: readonly string[];
  lastSuccessfulScan: string | null;
  lastError: string | null;
};

const sourceRegistry = [
  {
    slug: "ebay",
    displayName: "eBay",
    accessMode: "approved_api",
    status: "live_api",
    statusLabel: "LIVE API",
    usagePolicy: "valuation_and_bargain_discovery",
    soldCompValuationAllowed: true,
    automatedSearchEnabled: true,
    activeListingSupport: "live",
    soldHistorySupport: "manual",
    imageSupport: "live",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Approved eBay Browse API access is the active automated Profit Hunter source.",
    rateLimitNotes:
      "Hot Watch stays deliberately small; broader exact-card mining remains on the six-hour schedule.",
    warnings: [
      "Active asking prices are not sold comps.",
      "Completed buyer receipts may be promoted to verified purchase comps only after exact-card review.",
      "Low-confidence title matches and lot candidates must remain review-only.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "sportscardspro",
    displayName: "SportsCardsPro",
    accessMode: "manual_research",
    status: "manual_research",
    statusLabel: "PRICE GUIDE RESEARCH",
    usagePolicy: "price_guide_research_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "none",
    soldHistorySupport: "manual",
    imageSupport: "manual",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Public card pages may be referenced manually with visible attribution. Automated price-data use requires approved access and terms appropriate to the intended product surface.",
    rateLimitNotes:
      "No crawler or automated historic-sale importer is enabled. Operators may save attributed item-only guide observations through the research-only lane.",
    warnings: [
      "SportsCardsPro states that its historic prices exclude shipping and transaction costs.",
      "Item-only guide values and historic-sale summaries are research evidence, not delivered-price sold comps.",
      "SportsCardsPro research cannot make a TCOS deal actionable or alter InstaComp™ verified sold-comp valuation.",
      "Preserve SportsCardsPro attribution and a direct source link with every saved observation.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "etsy",
    displayName: "Etsy",
    accessMode: "approved_api",
    status: "access_needed",
    statusLabel: "ACCESS NEEDED",
    usagePolicy: "bargain_discovery_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "planned",
    soldHistorySupport: "none",
    imageSupport: "planned",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Official API capabilities, authentication, rate limits, and commercial-use terms still require verification before connection.",
    rateLimitNotes: "No automated Etsy requests are enabled.",
    warnings: [
      "Use Etsy only to discover active bargains after approved access is verified and tested.",
      "Etsy prices and transaction evidence must never enter InstaComp™ sold-comp valuation.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "sportlots",
    displayName: "Sportlots",
    accessMode: "manual_research",
    status: "manual_research",
    statusLabel: "MANUAL RESEARCH",
    usagePolicy: "bargain_discovery_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "manual",
    soldHistorySupport: "none",
    imageSupport: "none",
    checklistSupport: "manual",
    directLinkSupport: true,
    authorizationStatus:
      "Research-link helpers are available. No approved automated Sportlots scanner is configured.",
    rateLimitNotes: "Operator opens generated research links manually.",
    warnings: [
      "Use Sportlots for bargain discovery, availability, and secondary checklist research only.",
      "Sportlots history and prices must never enter InstaComp™ sold-comp valuation.",
      "Sportlots is not the sole checklist authority.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "mercari",
    displayName: "Mercari",
    accessMode: "manual_research",
    status: "manual_research",
    statusLabel: "MANUAL RESEARCH",
    usagePolicy: "bargain_discovery_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "manual",
    soldHistorySupport: "none",
    imageSupport: "manual",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Use operator research, user-provided URLs, screenshots, and approved import workflows only.",
    rateLimitNotes: "No automated Mercari requests are enabled.",
    warnings: [
      "Do not build or describe an unauthorized Mercari crawler.",
      "Use Mercari listing evidence only to discover bargains and review candidate cards.",
      "Mercari prices and sold claims must never enter InstaComp™ sold-comp valuation.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "facebook_marketplace",
    displayName: "Facebook Marketplace",
    accessMode: "manual_research",
    status: "manual_research",
    statusLabel: "MANUAL RESEARCH",
    usagePolicy: "bargain_discovery_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "manual",
    soldHistorySupport: "none",
    imageSupport: "manual",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Use operator research, user-provided listing links, screenshots, and approved workflows only.",
    rateLimitNotes: "No automated Facebook Marketplace requests are enabled.",
    warnings: [
      "Do not build or describe an unauthorized Facebook Marketplace crawler.",
      "Use Facebook Marketplace only to locate bargains and local buying opportunities.",
      "Facebook Marketplace prices and sold claims must never enter InstaComp™ sold-comp valuation.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
  {
    slug: "blowout_forums",
    displayName: "Blowout Cards Forums",
    accessMode: "manual_research",
    status: "manual_research",
    statusLabel: "INDEXED RESEARCH",
    usagePolicy: "bargain_discovery_only",
    soldCompValuationAllowed: false,
    automatedSearchEnabled: false,
    activeListingSupport: "manual",
    soldHistorySupport: "none",
    imageSupport: "manual",
    checklistSupport: "none",
    directLinkSupport: true,
    authorizationStatus:
      "Public search-index links are integrated directly into the existing Profit Hunter buying desk. TCOS does not make automated requests to the forum.",
    rateLimitNotes:
      "No crawler, login automation, verification bypass, auto-posting, seller messaging, or background thread polling is enabled.",
    warnings: [
      "Use Blowout only for bargain discovery, priced lots, collection liquidations, and mislist research inside Profit Hunter.",
      "Never automate forum login, search verification, CAPTCHA handling, posting, bumping, or private messages.",
      "Do not copy entire threads or repeatedly poll forum pages.",
      "Forum asking prices, claimed sales, and deal comments must never enter InstaComp™ sold-comp valuation.",
      "Confirm seller feedback, availability, exact cards, delivered price, and protected payment terms manually.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
] as const satisfies readonly MarketIntelSourceDefinition[];

function normalizedSourceSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const nonValuationAliases = new Set([
  "sportscardspro",
  "sports_cards_pro",
  "pricecharting",
  "price_charting",
  "etsy",
  "mercari",
  "sportlots",
  "facebook",
  "facebook_marketplace",
  "facebookmarketplace",
  "blowout",
  "blowout_forums",
  "blowoutcards",
  "blowout_cards",
  "blowout_cards_forums",
]);

export function getMarketIntelSourceRegistry(): MarketIntelSourceDefinition[] {
  return sourceRegistry.map((source) => ({
    ...source,
    warnings: [...source.warnings],
  }));
}

export function getMarketIntelSource(
  slug: MarketIntelSourceDefinition["slug"],
): MarketIntelSourceDefinition {
  const source = sourceRegistry.find((entry) => entry.slug === slug);
  if (!source) throw new Error(`Unknown Market Intel source: ${slug}`);
  return { ...source, warnings: [...source.warnings] };
}

export function marketIntelSourceAllowsSoldCompValuation(slug: string) {
  const normalized = normalizedSourceSlug(slug);
  const source = sourceRegistry.find((entry) => entry.slug === normalized);
  if (source) return source.soldCompValuationAllowed;
  return !nonValuationAliases.has(normalized);
}

export function marketIntelSourceValuationPolicyLabel(
  source: Pick<
    MarketIntelSourceDefinition,
    "usagePolicy" | "soldCompValuationAllowed"
  >,
) {
  if (source.soldCompValuationAllowed) {
    return "Verified sold-comp evidence may be used";
  }
  if (source.usagePolicy === "price_guide_research_only") {
    return "Item-price guide research only — blocked from sold comps";
  }
  return "Bargain discovery only — blocked from sold comps";
}

export function assertMarketIntelSourceAllowsSoldCompValuation(slug: string) {
  if (marketIntelSourceAllowsSoldCompValuation(slug)) return;
  const normalized = normalizedSourceSlug(slug);
  const source = sourceRegistry.find((entry) => entry.slug === normalized);
  const label = source?.displayName || slug || "This source";
  const policy =
    source?.usagePolicy === "price_guide_research_only"
      ? "price-guide research-only"
      : "bargain-discovery-only";
  throw new Error(
    `${label} is ${policy} and cannot be saved as an InstaComp™ sold comp.`,
  );
}

export function marketIntelSourceStatusTone(status: MarketIntelSourceStatus) {
  if (status === "live_api") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (status === "manual_research" || status === "import") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  if (status === "access_needed") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  if (status === "error") {
    return "border-rose-300 bg-rose-100 text-rose-950";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-900";
}
