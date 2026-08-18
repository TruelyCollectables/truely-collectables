import { DealHunterEbayBrowseAdapter } from "../../../../lib/deal-hunter-ebay-native-search";
import {
  buildDealHunterEbayQueryFamilies,
  DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT,
  DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT,
  extractEbayItemId,
  parseDealHunterPlayers,
  screenDealHunterEbayTitle,
} from "../../../../lib/deal-hunter-ebay-query-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SCOPES = new Set([
  "wnba",
  "ivan_demidov",
  "matvei_michkov_young_guns",
  "baseball_prospects",
  "signed_baseballs",
  "all",
]);

function clampPerQuery(value) {
  const parsed = Number(value || 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.floor(parsed), 5), 50);
}

function responseHeaders() {
  return {
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: responseHeaders() });
}

function deploymentInfo() {
  return {
    environment: process.env.TCOS_DEPLOYMENT_ENV || process.env.NODE_ENV || null,
    commitSha: String(process.env.TCOS_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    region: process.env.CLOUDFLARE_REGION || null,
  };
}

function rawEbayItem(entry) {
  return entry?.rawPayload?.raw_payload || entry?.rawPayload?.rawPayload || entry?.rawPayload || {};
}

function hoursSince(value, now = Date.now()) {
  const parsed = new Date(value || 0).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0, (now - parsed) / 3_600_000);
}

function minutesUntil(value, now = Date.now()) {
  const parsed = new Date(value || 0).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return (parsed - now) / 60_000;
}

function freshnessBucket(hours) {
  if (hours == null) return "UNKNOWN";
  if (hours <= 24) return "NEW_24H";
  if (hours <= 72) return "NEW_72H";
  if (hours <= 168) return "NEW_7D";
  return "OLDER";
}

function safeListing(entry, family, screening) {
  const raw = rawEbayItem(entry);
  const itemId = extractEbayItemId(raw) || extractEbayItemId({ url: entry.url });
  const buyingOptions = Array.isArray(raw.buyingOptions) ? raw.buyingOptions.map(String) : [];
  const imageUrls = Array.from(
    new Set([
      ...(entry.imageUrls || []),
      raw.image?.imageUrl,
      ...(raw.thumbnailImages || []).map((image) => image?.imageUrl),
      ...(raw.additionalImages || []).map((image) => image?.imageUrl),
    ].filter(Boolean)),
  ).slice(0, 12);
  const itemCreationDate = raw.itemOriginDate || raw.itemCreationDate || entry.discoveredAt || null;
  const itemEndDate = raw.itemEndDate || null;
  const listingAgeHours = hoursSince(itemCreationDate);
  const auctionMinutesRemaining = buyingOptions.includes("AUCTION")
    ? minutesUntil(itemEndDate)
    : null;
  const analysis = screening.analysis || {};
  const lotQuantity = analysis.lotQuantityGuess || null;
  const itemPrice = entry.askingPrice ?? null;
  const unitPriceEstimate =
    lotQuantity && Number.isFinite(Number(itemPrice))
      ? Number((Number(itemPrice) / lotQuantity).toFixed(2))
      : null;

  return {
    candidateId: itemId ? `ebay:${itemId}` : `ebay-url:${entry.url}`,
    marketplace: "eBay",
    listingItemId: itemId,
    listingUrl: entry.url,
    title: entry.title,
    watchedPerson: family.watchedPerson,
    lane: family.lane,
    itemType: family.itemType,
    queryFamilyIds: [family.familyId],
    itemPrice,
    currency: raw.price?.currency || "USD",
    inboundShipping: entry.shipping ?? null,
    buyerFees: entry.buyerFees ?? null,
    tax: entry.tax ?? null,
    sellerName: entry.sellerName || raw.seller?.username || null,
    buyingOptions,
    condition: raw.condition || raw.conditionId || null,
    itemCreationDate,
    itemEndDate,
    listingAgeHours:
      listingAgeHours == null ? null : Number(listingAgeHours.toFixed(2)),
    freshnessBucket: freshnessBucket(listingAgeHours),
    auctionMinutesRemaining:
      auctionMinutesRemaining == null
        ? null
        : Number(auctionMinutesRemaining.toFixed(1)),
    auctionEndingSoon:
      auctionMinutesRemaining != null &&
      auctionMinutesRemaining >= 0 &&
      auctionMinutesRemaining <= 180,
    location: entry.location || null,
    categoryNames: analysis.categories || [],
    targetMatchMethod: analysis.targetMatch?.method || null,
    targetMatchedInTitle: Boolean(analysis.targetMatchedInTitle),
    targetMatchedInMetadata: Boolean(analysis.targetMatchedInMetadata),
    cardNumberGuess: analysis.cardNumberGuess || null,
    lotSignal: Boolean(analysis.lotSignal),
    lotQuantityGuess: lotQuantity,
    unitPriceEstimate,
    mislistReasons: analysis.mislistReasons || [],
    imageUrls,
    manualReviewRequired: Boolean(entry.manualReviewRequired || screening.manualReviewRequired),
    preliminaryScopeStatus: screening.manualReviewRequired
      ? "IMAGE_OR_IDENTITY_REVIEW_REQUIRED"
      : "DISCOVERY_SCOPE_PASS",
    preliminaryRisks: screening.reviewReasons,
  };
}

function mergeListing(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    queryFamilyIds: Array.from(new Set([...existing.queryFamilyIds, ...incoming.queryFamilyIds])),
    watchedPersons: Array.from(
      new Set([...(existing.watchedPersons || [existing.watchedPerson]), incoming.watchedPerson].filter(Boolean)),
    ),
    lanes: Array.from(new Set([...(existing.lanes || [existing.lane]), incoming.lane].filter(Boolean))),
    manualReviewRequired: existing.manualReviewRequired || incoming.manualReviewRequired,
    preliminaryRisks: Array.from(new Set([...(existing.preliminaryRisks || []), ...(incoming.preliminaryRisks || [])])),
    mislistReasons: Array.from(new Set([...(existing.mislistReasons || []), ...(incoming.mislistReasons || [])])),
    imageUrls: Array.from(new Set([...(existing.imageUrls || []), ...(incoming.imageUrls || [])])).slice(0, 12),
  };
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 403|access denied/i.test(message)) return "EBAY_BUY_API_ACCESS_DENIED";
  if (/HTTP 429|rate limit/i.test(message)) return "EBAY_BROWSE_RATE_LIMITED";
  if (/timed out|AbortError|aborted/i.test(message)) return "EBAY_BROWSE_TIMEOUT";
  if (/token/i.test(message)) return "EBAY_APPLICATION_TOKEN_FAILED";
  return "EBAY_BROWSE_QUERY_FAILED";
}

function sourceStatus({ coverage, errors, families, adapter }) {
  const succeeded = coverage.filter((entry) => entry.status === "COMPLETE").length;
  const failed = errors.length;
  return {
    source: "eBay Browse",
    status:
      failed === 0 && succeeded === families.length
        ? "COMPLETE"
        : succeeded > 0
          ? "PARTIAL"
          : "FAILED",
    configured: adapter.configured,
    checkedAt: new Date().toISOString(),
    attemptedQueryFamilies: families.length,
    successfulQueryFamilies: succeeded,
    failedQueryFamilies: failed,
    sort: "newlyListed",
    deeperScreeningEnabled: true,
    typoRescueEnabled: families.some((family) => family.rescueMode),
    metadataTitleRescueEnabled: true,
    lotDetectionEnabled: true,
    wrongCategorySignalEnabled: true,
    auctionEndingSignalEnabled: true,
  };
}

export async function GET(request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const scope = String(url.searchParams.get("scope") || "wnba").toLowerCase();
  const perQuery = clampPerQuery(url.searchParams.get("perQuery"));

  if (!SCOPES.has(scope)) {
    return json({
      ok: false,
      schema: "TCOS_NATIVE_EBAY_FEED_V1",
      code: "UNSUPPORTED_SCOPE",
      supportedScopes: [...SCOPES],
    }, 400);
  }

  const players = parseDealHunterPlayers(url.searchParams.get("players"));
  const families = buildDealHunterEbayQueryFamilies({ scope, players });
  const adapter = new DealHunterEbayBrowseAdapter();
  const deployment = deploymentInfo();

  if (!adapter.configured) {
    return json({
      ok: false,
      schema: "TCOS_NATIVE_EBAY_FEED_V1",
      code: "EBAY_BROWSE_NOT_CONFIGURED",
      nativeEbayUsed: false,
      scope,
      deployment,
      sourceStatus: {
        source: "eBay Browse",
        status: "FAILED",
        configured: false,
        checkedAt: new Date().toISOString(),
        attemptedQueryFamilies: 0,
        successfulQueryFamilies: 0,
        failedQueryFamilies: 0,
      },
    }, 503);
  }

  const outcomes = await Promise.allSettled(
    families.map(async (family) => {
      const familyStartedAt = Date.now();
      const result = await adapter.search({
        query: family.query,
        sources: ["eBay"],
        filters: {},
        maxResults: perQuery,
      });
      const accepted = [];
      const rejectionCounts = {};

      for (const entry of result.results || []) {
        const raw = rawEbayItem(entry);
        const screening = screenDealHunterEbayTitle({
          title: entry.title,
          description: entry.description,
          raw,
          family,
        });
        if (!screening.accepted) {
          for (const reason of screening.rejectionReasons) {
            rejectionCounts[reason] = Number(rejectionCounts[reason] || 0) + 1;
          }
          continue;
        }
        accepted.push(safeListing(entry, family, screening));
      }

      const returned = accepted.slice(0, perQuery);
      return {
        family,
        coverage: {
          familyId: family.familyId,
          watchedPerson: family.watchedPerson,
          lane: family.lane,
          query: family.query,
          rescueMode: Boolean(family.rescueMode),
          status: "COMPLETE",
          rawResultCount: result.results?.length || 0,
          acceptedResultCount: accepted.length,
          returnedResultCount: returned.length,
          rejectedResultCount: (result.results?.length || 0) - accepted.length,
          rejectionCounts,
          warnings: result.warnings || [],
          searchDiagnostics: result.diagnostics || null,
          durationMs: Date.now() - familyStartedAt,
        },
        accepted: returned,
      };
    }),
  );

  const coverage = [];
  const errors = [];
  const deduplicated = new Map();

  outcomes.forEach((outcome, index) => {
    const family = families[index];
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      const code = classifyError(outcome.reason);
      coverage.push({
        familyId: family.familyId,
        watchedPerson: family.watchedPerson,
        lane: family.lane,
        query: family.query,
        rescueMode: Boolean(family.rescueMode),
        status: "FAILED",
        rawResultCount: 0,
        acceptedResultCount: 0,
        returnedResultCount: 0,
        rejectedResultCount: 0,
        rejectionCounts: {},
        warnings: [],
        errorCode: code,
        error: message,
      });
      errors.push({ familyId: family.familyId, code, error: message });
      return;
    }

    coverage.push(outcome.value.coverage);
    for (const listing of outcome.value.accepted) {
      const key = listing.listingItemId || listing.listingUrl;
      deduplicated.set(key, mergeListing(deduplicated.get(key), listing));
    }
  });

  const successfulQueryCount = coverage.filter((entry) => entry.status === "COMPLETE").length;
  const wnbaFamilyCount = families.filter((family) => family.scope === "wnba").length;
  const michkovFamilyCount = families.filter((family) => family.scope === "matvei_michkov_young_guns").length;
  const requiredWnbaFamiliesExecuted =
    !["wnba", "all"].includes(scope) ||
    (wnbaFamilyCount === DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT &&
      coverage.filter((entry) => entry.familyId.startsWith("wnba.") && entry.status === "COMPLETE").length === DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT);
  const requiredMichkovFamiliesExecuted =
    !["matvei_michkov_young_guns", "all"].includes(scope) ||
    (michkovFamilyCount === DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT &&
      coverage.filter((entry) => entry.familyId.startsWith("matvei-michkov.") && entry.status === "COMPLETE").length === DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT);
  const complete = errors.length === 0 && successfulQueryCount === families.length && requiredWnbaFamiliesExecuted && requiredMichkovFamiliesExecuted;

  return json({
    ok: complete,
    schema: "TCOS_NATIVE_EBAY_FEED_V1",
    featureVersion: "WNBA_EBAY_HARDENING_V2",
    generatedAt: new Date().toISOString(),
    scope,
    requestedPlayers: ["baseball_prospects", "signed_baseballs", "all"].includes(scope) ? players : [],
    deployment,
    marketplace: "eBay",
    searchEngine: "Production eBay Browse item_summary/search sorted newlyListed with 2x screening depth and rescue lanes",
    tokenMode: "client_credentials",
    nativeEbayUsed: successfulQueryCount > 0,
    queryFamilyCount: families.length,
    successfulQueryCount,
    failedQueryCount: errors.length,
    requiredWnbaFamilyCount: ["wnba", "all"].includes(scope) ? DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT : 0,
    requiredWnbaFamiliesExecuted,
    requiredMichkovFamilyCount: ["matvei_michkov_young_guns", "all"].includes(scope) ? DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT : 0,
    requiredMichkovFamiliesExecuted,
    perQuery,
    rawResultCount: coverage.reduce((sum, entry) => sum + Number(entry.rawResultCount || 0), 0),
    deduplicatedResultCount: deduplicated.size,
    results: [...deduplicated.values()].sort(
      (a, b) => new Date(b.itemCreationDate || 0).getTime() - new Date(a.itemCreationDate || 0).getTime(),
    ),
    sourceStatus: sourceStatus({ coverage, errors, families, adapter }),
    sourceCoverage: coverage,
    errors,
    durationMs: Date.now() - startedAt,
    boundaries: {
      fixedScopesOnly: true,
      arbitraryQueryAccepted: false,
      publicListingsOnly: true,
      credentialsExposed: false,
      purchaseCapability: false,
      ledgerMutationCapability: false,
    },
  }, complete ? 200 : 502);
}
