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

export type MarketIntelSourceDefinition = {
  slug: "ebay" | "etsy" | "sportlots" | "mercari";
  displayName: string;
  accessMode: MarketIntelSourceAccessMode;
  status: MarketIntelSourceStatus;
  statusLabel: string;
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
    slug: "etsy",
    displayName: "Etsy",
    accessMode: "approved_api",
    status: "access_needed",
    statusLabel: "ACCESS NEEDED",
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
      "Do not call Etsy automated until approved access is verified and tested.",
      "Etsy active prices must never be treated as sold comps.",
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
    automatedSearchEnabled: false,
    activeListingSupport: "manual",
    soldHistorySupport: "manual",
    imageSupport: "none",
    checklistSupport: "manual",
    directLinkSupport: true,
    authorizationStatus:
      "Research-link helpers are available. No approved automated Sportlots scanner is configured.",
    rateLimitNotes: "Operator opens generated research links manually.",
    warnings: [
      "Do not claim live Sportlots mining.",
      "Sportlots is secondary checklist and availability evidence, not the sole checklist authority.",
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
      "Image findings from user-provided screenshots require exact-card review before scoring.",
    ],
    lastSuccessfulScan: null,
    lastError: null,
  },
] as const satisfies readonly MarketIntelSourceDefinition[];

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
