import { publicSearchService } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const SCOPES = new Set(["shoe_deals", "card_opportunities"]);
const SHOE_NEW = /(?:\bbrand\s*new\b|\bnew\s+with\s+tags\b|\bnew\s+in\s+box\b|\bnew\s+without\s+box\b|\bnwt\b|\bnib\b|\bnwob\b|\bdeadstock\b|\bnew\b(?!\s+balance))/i;
const SHOE_USED = /\b(?:pre[- ]?owned|used|worn|gently\s+used|worn\s+once)\b/i;
const SHOE_KIDS = /\b(?:kid(?:s)?|youth|toddler|child(?:ren)?|boys?|girls?)\b/i;

const FAMILIES = Object.freeze({
  shoe_deals: [
    { familyId: "shoe-deal.mercari", sources: ["Mercari"],
      query: "brand new adult New Balance Adidas Timberland Pro shoes sneakers boots at or below $30 currently for sale on Mercari",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
    { familyId: "shoe-deal.poshmark-adidas", sources: ["Poshmark"],
      query: "adidas nwt shoes sneakers",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
    { familyId: "shoe-deal.poshmark-new-balance", sources: ["Poshmark"],
      query: "new balance nwt shoes sneakers",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
    { familyId: "shoe-deal.poshmark-timberland-pro", sources: ["Poshmark"],
      query: "timberland pro nwt boots shoes",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
  ],
  card_opportunities: [
    { familyId: "mercari.wnba-rookie-lots", sources: ["Mercari"],
      query: "site:mercari.com/us/item WNBA rookie card lot Paige Bueckers Dominique Malonga Sonia Citron Kiki Iriafen",
      lane: "broad_professional_rookies", watchedPerson: "WNBA Rookie Deal Watch", itemType: "trading_card" },
    { familyId: "mercari.wnba-base-rookies", sources: ["Mercari"],
      query: "site:mercari.com/us/item 2025 WNBA rookie card base Prizm Select Paige Bueckers Malonga Citron",
      lane: "broad_professional_rookies", watchedPerson: "WNBA Base Rookie Deal Watch", itemType: "trading_card" },
    { familyId: "mercari.first-bowman-prospects", sources: ["Mercari"],
      query: "site:mercari.com/us/item 1st Bowman Chrome prospect card Leo De Vries Josue De Paula Jesus Made Franklin Arias",
      lane: "true_first_bowman", watchedPerson: "1st Bowman Prospect Deal Watch", itemType: "trading_card" },
    { familyId: "mercari.signed-prospect-baseballs", sources: ["Mercari"],
      query: "site:mercari.com/us/item signed baseball autograph prospect official major league baseball Leo De Vries Josue De Paula",
      lane: "signed_prospect_baseball", watchedPerson: "Signed Prospect Baseball Watch", itemType: "signed_baseball" },
    { familyId: "mercari.music-comedy-autographs", sources: ["Mercari"],
      query: "site:mercari.com/us/item signed poster album CD autograph country rock metal comedian",
      lane: "music_comedy_autographs", watchedPerson: "Music Comedy Autograph Watch", itemType: "autograph_flat" },
    { familyId: "mercari.cheap-card-lots", sources: ["Mercari"],
      query: "site:mercari.com/us/item sports card lot rookie chrome prizm select under 20",
      lane: "cheap_card_lots", watchedPerson: "Cheap Card Lot Watch", itemType: "trading_card_lot" },
  ],
});

function clampPerQuery(value) {
  const parsed = Number(value || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(Math.floor(parsed), 5), 30);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function directMarketplace(urlValue) {
  try {
    const url = new URL(String(urlValue || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "mercari.com" && /\/item\/m\d+/i.test(url.pathname)) return "Mercari";
    if (host === "poshmark.com" && /\/listing\//i.test(url.pathname)) return "Poshmark";
    return null;
  } catch {
    return null;
  }
}

function listingItemId(urlValue, marketplace) {
  const value = String(urlValue || "");
  if (marketplace === "Mercari") return value.match(/\/item\/(m\d+)/i)?.[1] || null;
  if (marketplace === "Poshmark") return value.match(/\/listing\/[^/?#]*-([a-f0-9]{12,})/i)?.[1] || null;
  return null;
}

function shoeBrand(value) {
  if (/\bnew\s+balance\b/i.test(value)) return "New Balance";
  if (/\badidas\b/i.test(value)) return "Adidas";
  if (/\btimberland\s+pro\b/i.test(value)) return "Timberland Pro";
  return null;
}

function cardOpportunityPasses(evidence, family) {
  if (!/\b(?:card|cards|rookie|rc|bowman|chrome|prizm|select|lot|autograph|signed|poster|album|cd)\b/i.test(evidence)) {
    return false;
  }
  if (family.itemType === "signed_baseball") {
    return /\b(?:signed|autograph(?:ed)?|auto)\b/i.test(evidence) && /\b(?:baseball|ball|omlb|rawlings)\b/i.test(evidence);
  }
  if (family.itemType === "autograph_flat") {
    return /\b(?:signed|autograph(?:ed)?|auto)\b/i.test(evidence) && /\b(?:poster|album|vinyl|lp|cd|booklet|setlist|photo)\b/i.test(evidence);
  }
  if (family.itemType === "trading_card_lot") {
    return /\b(?:lot|bundle|collection|2x|rookies|cards)\b/i.test(evidence);
  }
  return true;
}

function safeListing(entry, family) {
  const marketplace = directMarketplace(entry.url);
  if (!marketplace || !family.sources.includes(marketplace)) return null;
  const title = String(entry.title || "Untitled listing").trim();
  const description = String(entry.description || "").trim();
  const evidence = `${title} ${description}`.trim();
  const itemPrice = numberValue(entry.askingPrice);
  const shipping = numberValue(entry.shipping);
  const buyerFees = numberValue(entry.buyerFees);
  const tax = numberValue(entry.tax);
  const images = Array.from(new Set((entry.imageUrls || []).map(String).filter((value) => /^https?:\/\//i.test(value))));
  const risks = [];
  let manualReviewRequired = Boolean(entry.manualReviewRequired);

  if (family.itemType === "new_adult_shoes") {
    const brand = shoeBrand(evidence);
    if (!brand || !SHOE_NEW.test(evidence) || SHOE_USED.test(evidence) || SHOE_KIDS.test(evidence)) return null;
    if (marketplace === "Poshmark" && String(entry.conditionText || "").toLowerCase() !== "nwt") return null;
    if (itemPrice === null || itemPrice > 30) return null;
    if (shipping !== null && shipping > 15) return null;
    if (!/\b(?:men(?:'s)?|women(?:'s)?|adult|size\s*(?:[5-9]|1[0-9])(?:\.5)?\b)\b/i.test(evidence)) {
      manualReviewRequired = true;
      risks.push("adult_size_not_proven_from_public_listing_text");
    }
    risks.push(`shoe_brand:${brand}`);
  } else {
    if (!cardOpportunityPasses(evidence, family)) return null;
    if (images.length < 2) {
      manualReviewRequired = true;
      risks.push("front_back_image_pair_not_publicly_exposed");
    }
    if (marketplace === "Mercari") {
      manualReviewRequired = true;
      risks.push("mercari_public_listing_requires_manual_verification");
    }
  }

  if (entry.verificationNotes) risks.push(String(entry.verificationNotes).slice(0, 500));
  return {
    listingItemId: listingItemId(entry.url, marketplace),
    listingUrl: String(entry.url),
    marketplace,
    lane: family.lane,
    watchedPerson: family.watchedPerson,
    itemType: family.itemType,
    title,
    sellerName: entry.sellerName || null,
    itemPrice,
    inboundShipping: shipping,
    buyerFees,
    tax,
    imageUrls: images,
    manualReviewRequired,
    preliminaryRisks: Array.from(new Set(risks)),
    queryFamilyIds: [family.familyId],
    itemCreationDate: entry.discoveredAt || new Date().toISOString(),
  };
}

function mergeListing(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    lane: existing.lane || incoming.lane,
    watchedPerson: existing.watchedPerson || incoming.watchedPerson,
    itemType: existing.itemType || incoming.itemType,
    imageUrls: Array.from(new Set([...(existing.imageUrls || []), ...(incoming.imageUrls || [])])),
    queryFamilyIds: Array.from(new Set([...(existing.queryFamilyIds || []), ...(incoming.queryFamilyIds || [])])),
    preliminaryRisks: Array.from(new Set([...(existing.preliminaryRisks || []), ...(incoming.preliminaryRisks || [])])),
    manualReviewRequired: Boolean(existing.manualReviewRequired || incoming.manualReviewRequired),
  };
}

export async function GET(request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "").trim().toLowerCase();
  const perQuery = clampPerQuery(url.searchParams.get("perQuery"));
  if (!SCOPES.has(scope)) {
    return Response.json({ ok: false, code: "UNSUPPORTED_SCOPE", supportedScopes: [...SCOPES] }, { status: 400 });
  }

  const providerStatus = publicSearchService.status();
  if (!providerStatus.poshmarkPublicApi && !providerStatus.geminiPublicWeb && !providerStatus.openAiPublicWeb) {
    return Response.json({
      ok: false,
      schema: "TCOS_PUBLIC_MARKETPLACE_FEED_V1",
      code: "PUBLIC_WEB_PROVIDER_NOT_CONFIGURED",
      scope,
    }, { status: 503 });
  }

  const families = FAMILIES[scope];
  const outcomes = await Promise.allSettled(families.map(async (family) => {
    const familyStartedAt = Date.now();
    const result = await publicSearchService.search({
      query: family.query,
      sources: family.sources,
      filters: { liveListingsOnly: true, directListingUrlsOnly: true },
      maxResults: perQuery,
      exactIdentityOnly: false,
    });
    const accepted = (result.results || []).map((entry) => safeListing(entry, family)).filter(Boolean);
    return {
      coverage: {
        familyId: family.familyId,
        watchedPerson: family.watchedPerson,
        lane: family.lane,
        query: family.query,
        status: "COMPLETE",
        rawResultCount: (result.results || []).length,
        acceptedResultCount: accepted.length,
        returnedResultCount: accepted.length,
        rejectedResultCount: Math.max(0, (result.results || []).length - accepted.length),
        warnings: result.warnings || [],
        sourceReports: result.sourceReports || [],
        durationMs: Date.now() - familyStartedAt,
      },
      accepted,
    };
  }));

  const coverage = [];
  const errors = [];
  const deduplicated = new Map();
  outcomes.forEach((outcome, index) => {
    const family = families[index];
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      coverage.push({ familyId: family.familyId, watchedPerson: family.watchedPerson,
        lane: family.lane, query: family.query, status: "FAILED",
        rawResultCount: 0, acceptedResultCount: 0, returnedResultCount: 0,
        rejectedResultCount: 0, warnings: [], error: message });
      errors.push({ familyId: family.familyId, error: message });
      return;
    }
    coverage.push(outcome.value.coverage);
    for (const listing of outcome.value.accepted) {
      const key = listing.listingItemId || listing.listingUrl;
      deduplicated.set(key, mergeListing(deduplicated.get(key), listing));
    }
  });

  const successfulQueryCount = coverage.filter((entry) => entry.status === "COMPLETE").length;
  const complete = errors.length === 0 && successfulQueryCount === families.length;
  return Response.json({
    ok: complete,
    schema: "TCOS_PUBLIC_MARKETPLACE_FEED_V1",
    generatedAt: new Date().toISOString(),
    scope,
    marketplace: "Mercari + Poshmark",
    providerMode: providerStatus.poshmarkPublicApi
      ? providerStatus.geminiPublicWeb
        ? "poshmark_public_api_plus_gemini_fallback"
        : providerStatus.openAiPublicWeb
          ? "poshmark_public_api_plus_openai_fallback"
          : "poshmark_public_api"
      : providerStatus.geminiPublicWeb
        ? "gemini_google_search_primary"
        : "openai_web_search_fallback",
    publicWebSearchUsed: successfulQueryCount > 0,
    queryFamilyCount: families.length,
    successfulQueryCount,
    failedQueryCount: errors.length,
    perQuery,
    rawResultCount: coverage.reduce((sum, entry) => sum + Number(entry.rawResultCount || 0), 0),
    deduplicatedResultCount: deduplicated.size,
    results: [...deduplicated.values()],
    sourceCoverage: coverage,
    errors,
    durationMs: Date.now() - startedAt,
    boundaries: {
      fixedScopesOnly: true,
      arbitraryQueryAccepted: false,
      publicListingsOnly: true,
      directListingUrlsOnly: true,
      purchaseCapability: false,
      ledgerMutationCapability: false,
    },
  }, { status: complete ? 200 : 502 });
}
