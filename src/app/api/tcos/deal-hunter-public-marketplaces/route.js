import { publicSearchService } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const SCOPES = new Set(["demidov_public_marketplaces", "shoe_deals"]);
const SHOE_NEW = /(?:\bbrand\s*new\b|\bnew\s+with\s+tags\b|\bnew\s+in\s+box\b|\bnew\s+without\s+box\b|\bnwt\b|\bnib\b|\bnwob\b|\bdeadstock\b|\bnew\b(?!\s+balance))/i;
const SHOE_USED = /\b(?:pre[- ]?owned|used|worn|gently\s+used|worn\s+once)\b/i;
const SHOE_KIDS = /\b(?:kid(?:s)?|youth|toddler|child(?:ren)?|boys?|girls?)\b/i;

const FAMILIES = Object.freeze({
  demidov_public_marketplaces: [
    { familyId: "demidov-public.mercari", sources: ["Mercari"],
      query: "Ivan Demidov hockey card rookie Young Guns parallel lot currently for sale on Mercari",
      lane: "public_marketplace_card", watchedPerson: "Ivan Demidov", itemType: "sports_card" },
    { familyId: "demidov-public.poshmark", sources: ["Poshmark"],
      query: "Ivan Demidov hockey card rookie Young Guns parallel lot currently for sale on Poshmark",
      lane: "public_marketplace_card", watchedPerson: "Ivan Demidov", itemType: "sports_card" },
  ],  shoe_deals: [
    { familyId: "shoe-deal.mercari", sources: ["Mercari"],
      query: "brand new adult New Balance Adidas Timberland Pro shoes sneakers boots under $25 currently for sale on Mercari",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
    { familyId: "shoe-deal.poshmark", sources: ["Poshmark"],
      query: "brand new adult New Balance Adidas Timberland Pro shoes sneakers boots under $25 currently for sale on Poshmark",
      lane: "shoe_deal", watchedPerson: "Shoe Deal Watch", itemType: "new_adult_shoes" },
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

function safeListing(entry, family) {
  const marketplace = directMarketplace(entry.url);
  if (!marketplace || !family.sources.includes(marketplace)) return null;
  const title = String(entry.title || "Untitled listing").trim();
  const description = String(entry.description || "").trim();  const evidence = `${title} ${description}`.trim();
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
    if (itemPrice === null || itemPrice > 25) return null;
    if (shipping !== null && shipping > 15) return null;
    if (!/\b(?:men(?:'s)?|women(?:'s)?|adult|size\s*(?:[5-9]|1[0-9])(?:\.5)?\b)\b/i.test(evidence)) {
      manualReviewRequired = true;
      risks.push("adult_size_not_proven_from_public_listing_text");
    }
    risks.push(`shoe_brand:${brand}`);
  } else {
    if (!/\bivan\s+demidov\b/i.test(evidence)) return null;
    if (images.length < 2) {
      manualReviewRequired = true;
      risks.push("front_back_image_pair_not_publicly_exposed");
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
  if (!providerStatus.openAiPublicWeb) {
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
    providerMode: "openai_web_search",
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
