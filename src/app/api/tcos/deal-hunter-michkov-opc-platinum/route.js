import { EbayBrowseAdapter } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const QUERY_FAMILIES = Object.freeze([
  {
    familyId: "matvei-michkov-opc-platinum.exact-o-pee-chee-rainbow",
    query: "Matvei Michkov 2024-25 O-Pee-Chee Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.opc-rainbow",
    query: "Matvei Michkov 2024-25 OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.o-pee-chee-no-punctuation",
    query: "Matvei Michkov 2024-25 O Pee Chee Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.color-numbered-parallels",
    query: "Matvei Michkov OPC Platinum rookie parallel color numbered",
  },
  {
    familyId: "matvei-michkov-opc-platinum.rookie-autographs",
    query: "Matvei Michkov O-Pee-Chee Platinum rookie autograph auto",
  },
  {
    familyId: "matvei-michkov-opc-platinum.matvey-first-name",
    query: "Matvey Michkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.matei-first-name",
    query: "Matei Michkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.michov-surname",
    query: "Matvei Michov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.mikhkov-surname",
    query: "Matvei Mikhkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.mitchkov-surname",
    query: "Mitchkov OPC Platinum rookie parallel Philadelphia Flyers",
  },
]);

const MICHKOV_NAME_OR_VARIANT = /\b(michkov|michov|mikhkov|mitchkov)\b/i;
const MICHKOV_CANONICAL_NAME = /\bmatvei\s+michkov\b/i;
const OPC_PLATINUM_SIGNAL = /\b(?:o[\s.-]?pee[\s.-]?chee|opc)\s+platinum\b/i;
const ROOKIE_SIGNAL = /\b(?:rookie|rc)\b/i;
const EXPLICIT_BASE = /\bbase(?:\s+card)?\b/i;
const PROHIBITED_LISTING =
  /\b(custom|reprint|facsimile|digital card|nft|mystery|break spot|box break|case break|replica|checklist)\b/i;
const RAINBOW_OR_BETTER =
  /\b(rainbow|retro rainbow|sunset|yellow traxx|red prism|violet pixels|arctic freeze|emerald surge|orange checkers|seismic gold|golden treasures|neon yellow|aqua marine|blue rainbow|pink matte|color wheel|parallel|numbered|serial numbered|auto|autograph|signature)\b|\/\d{1,4}\b/i;

function clampPerQuery(value) {
  const parsed = Number(value || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(Math.floor(parsed), 5), 20);
}

function responseHeaders() {
  return {
    "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: responseHeaders() });
}

function deploymentInfo() {
  return {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    commitSha:
      String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    region: process.env.VERCEL_REGION || null,
  };
}

function rawEbayItem(entry) {
  return (
    entry?.rawPayload?.raw_payload ||
    entry?.rawPayload?.rawPayload ||
    entry?.rawPayload ||
    {}
  );
}

function extractItemId(raw, url) {
  const direct = String(raw?.itemId || raw?.legacyItemId || "").trim();
  if (direct) return direct;
  return String(url || "").match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/i)?.[1] || null;
}

function screenTitle(title) {
  const value = String(title || "").trim();
  const rejectionReasons = [];
  const reviewReasons = [];

  if (!value) rejectionReasons.push("missing_title");
  if (PROHIBITED_LISTING.test(value)) {
    rejectionReasons.push("custom_reprint_digital_break_mystery_or_checklist");
  }
  if (!MICHKOV_NAME_OR_VARIANT.test(value)) {
    rejectionReasons.push("michkov_name_or_variant_not_claimed");
  }
  if (!OPC_PLATINUM_SIGNAL.test(value)) {
    rejectionReasons.push("opc_platinum_product_not_claimed");
  }
  if (EXPLICIT_BASE.test(value) && !RAINBOW_OR_BETTER.test(value)) {
    rejectionReasons.push("ordinary_base_excluded");
  } else if (!RAINBOW_OR_BETTER.test(value)) {
    reviewReasons.push("rainbow_or_better_not_proven_from_title_verify_images");
  }
  if (!ROOKIE_SIGNAL.test(value)) {
    reviewReasons.push("rookie_status_not_explicit_verify_exact_card");
  }
  if (!MICHKOV_CANONICAL_NAME.test(value)) {
    reviewReasons.push("seller_name_variant_or_misspelling_detected_verify_images");
  }

  return {
    accepted: rejectionReasons.length === 0,
    manualReviewRequired: reviewReasons.length > 0,
    rejectionReasons,
    reviewReasons,
  };
}

function safeListing(entry, familyId, screening) {
  const raw = rawEbayItem(entry);
  const listingItemId = extractItemId(raw, entry.url);
  const imageUrls = Array.from(
    new Set(
      [
        ...(entry.imageUrls || []),
        raw.image?.imageUrl,
        ...(raw.thumbnailImages || []).map((image) => image?.imageUrl),
      ].filter(Boolean),
    ),
  ).slice(0, 12);

  return {
    candidateId: listingItemId ? `ebay:${listingItemId}` : `ebay-url:${entry.url}`,
    marketplace: "eBay",
    listingItemId,
    listingUrl: entry.url,
    title: entry.title,
    watchedPerson: "Matvei Michkov",
    lane: "opc_platinum_rookie_rainbow_or_better",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    queryFamilyIds: [familyId],
    itemPrice: entry.askingPrice ?? null,
    currency: raw.price?.currency || "USD",
    inboundShipping: entry.shipping ?? null,
    buyerFees: entry.buyerFees ?? null,
    tax: entry.tax ?? null,
    sellerName: entry.sellerName || raw.seller?.username || null,
    buyingOptions: Array.isArray(raw.buyingOptions)
      ? raw.buyingOptions.map(String)
      : [],
    condition: raw.condition || raw.conditionId || null,
    itemCreationDate: raw.itemCreationDate || null,
    itemEndDate: raw.itemEndDate || null,
    location: entry.location || null,
    imageUrls,
    minimumEligibleTier: "Rainbow",
    ordinaryBaseExcluded: true,
    manualReviewRequired: Boolean(
      entry.manualReviewRequired || screening.manualReviewRequired,
    ),
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
    queryFamilyIds: Array.from(
      new Set([...existing.queryFamilyIds, ...incoming.queryFamilyIds]),
    ),
    manualReviewRequired:
      existing.manualReviewRequired || incoming.manualReviewRequired,
    preliminaryRisks: Array.from(
      new Set([
        ...(existing.preliminaryRisks || []),
        ...(incoming.preliminaryRisks || []),
      ]),
    ),
    imageUrls: Array.from(
      new Set([...(existing.imageUrls || []), ...(incoming.imageUrls || [])]),
    ).slice(0, 12),
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

export async function GET(request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const perQuery = clampPerQuery(url.searchParams.get("perQuery"));
  const adapter = new EbayBrowseAdapter();
  const deployment = deploymentInfo();

  if (!adapter.configured) {
    return json(
      {
        ok: false,
        schema: "TCOS_NATIVE_EBAY_FEED_V1",
        code: "EBAY_BROWSE_NOT_CONFIGURED",
        nativeEbayUsed: false,
        scope: "matvei_michkov_opc_platinum",
        deployment,
      },
      503,
    );
  }

  const outcomes = await Promise.allSettled(
    QUERY_FAMILIES.map(async (family) => {
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
        const screening = screenTitle(entry.title);
        if (!screening.accepted) {
          for (const reason of screening.rejectionReasons) {
            rejectionCounts[reason] = Number(rejectionCounts[reason] || 0) + 1;
          }
          continue;
        }
        accepted.push(safeListing(entry, family.familyId, screening));
      }

      return {
        coverage: {
          familyId: family.familyId,
          watchedPerson: "Matvei Michkov",
          lane: "opc_platinum_rookie_rainbow_or_better",
          query: family.query,
          status: "COMPLETE",
          rawResultCount: result.results?.length || 0,
          acceptedResultCount: accepted.length,
          rejectedResultCount: (result.results?.length || 0) - accepted.length,
          rejectionCounts,
          warnings: result.warnings || [],
          durationMs: Date.now() - familyStartedAt,
        },
        accepted,
      };
    }),
  );

  const coverage = [];
  const errors = [];
  const deduplicated = new Map();

  outcomes.forEach((outcome, index) => {
    const family = QUERY_FAMILIES[index];
    if (outcome.status === "rejected") {
      const message =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      const code = classifyError(outcome.reason);
      coverage.push({
        familyId: family.familyId,
        watchedPerson: "Matvei Michkov",
        lane: "opc_platinum_rookie_rainbow_or_better",
        query: family.query,
        status: "FAILED",
        rawResultCount: 0,
        acceptedResultCount: 0,
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

  const successfulQueryCount = coverage.filter(
    (entry) => entry.status === "COMPLETE",
  ).length;
  const requiredQueryFamiliesExecuted =
    QUERY_FAMILIES.length === 10 && successfulQueryCount === QUERY_FAMILIES.length;
  const complete = errors.length === 0 && requiredQueryFamiliesExecuted;

  return json(
    {
      ok: complete,
      schema: "TCOS_NATIVE_EBAY_FEED_V1",
      generatedAt: new Date().toISOString(),
      scope: "matvei_michkov_opc_platinum",
      deployment,
      marketplace: "eBay",
      searchEngine: "Production eBay Browse item_summary/search",
      tokenMode: "client_credentials",
      nativeEbayUsed: successfulQueryCount > 0,
      queryFamilyCount: QUERY_FAMILIES.length,
      successfulQueryCount,
      failedQueryCount: errors.length,
      requiredMichkovOpcPlatinumFamilyCount: 10,
      requiredMichkovOpcPlatinumFamiliesExecuted: requiredQueryFamiliesExecuted,
      perQuery,
      rules: {
        player: "Matvei Michkov",
        product: "2024-25 O-Pee-Chee Platinum rookie",
        ordinaryBaseExcluded: true,
        minimumEligibleTier: "Rainbow",
        rawAndGradedSeparate: true,
        imageVerificationRequiredBeforePositiveLabel: true,
        exactCompAndTwentyPercentNetRoiRequired: true,
      },
      rawResultCount: coverage.reduce(
        (sum, entry) => sum + Number(entry.rawResultCount || 0),
        0,
      ),
      deduplicatedResultCount: deduplicated.size,
      results: [...deduplicated.values()],
      sourceCoverage: coverage,
      errors,
      durationMs: Date.now() - startedAt,
      boundaries: {
        fixedScopeOnly: true,
        arbitraryQueryAccepted: false,
        publicListingsOnly: true,
        credentialsExposed: false,
        purchaseCapability: false,
        ledgerMutationCapability: false,
      },
    },
    complete ? 200 : 502,
  );
}
