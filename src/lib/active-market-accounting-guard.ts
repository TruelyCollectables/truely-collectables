import "server-only";

import { createHash } from "node:crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedSellerAccountFromRequest,
} from "./account-auth";
import {
  buildActiveMarketEvidenceAccounting,
  canonicalActiveMarketCandidateId,
  type ActiveMarketTargetIdentity,
} from "./active-market-evidence-accounting";
import { handleActiveMarketAttackWithIntegrityGuard } from "./active-market-integrity-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const MAX_RESULTS = 50;
const MAX_QUERIES = 8;

type Json = Record<string, any>;

type SearchFailure = {
  query: string;
  status: number | null;
  message: string;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: unknown): string | null {
  const result = String(value || "").trim();
  return result || null;
}

function money(value: unknown, allowZero = false): number | null {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) {
    return null;
  }
  return Math.round(result * 100) / 100;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function printRun(value: unknown): number | null {
  const input = normalize(value);
  const match =
    input.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function hasAuto(value: unknown): boolean {
  return /\b(auto|autograph|autographs|autographed|signed|au)\b/.test(
    normalize(value),
  );
}

function hasRelic(value: unknown): boolean {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn|rpa)\b/.test(
    normalize(value),
  );
}

function hasGrade(value: unknown): boolean {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(
    normalize(value),
  );
}

function stripOldAccountingNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET EVIDENCE ACCOUNTING (?:PASSED|BLOCKED):[\s\S]*$/i, "")
    .trim();
}

function searchCandidate(value: unknown, query: string): Json | null {
  const row = record(value);
  const title = text(first(row.title));
  const legacyItemId = text(first(row.itemId));
  const url = text(first(row.viewItemURL));
  const selling = record(first(row.sellingStatus));
  const price = money(record(first(selling.currentPrice)).__value__);
  if (!title || !legacyItemId || !url || price === null) return null;

  const shipping = record(first(row.shippingInfo));
  const shippingCost = money(
    record(first(shipping.shippingServiceCost)).__value__,
    true,
  );
  const listing = record(first(row.listingInfo));
  const listingType = String(first(listing.listingType) || "");
  const buyItNow =
    String(first(listing.buyItNowAvailable) || "").toLowerCase() === "true";
  const fixedPrice =
    listingType === "FixedPrice" ||
    listingType === "StoreInventory" ||
    buyItNow;

  return {
    legacyItemId,
    itemId: legacyItemId,
    title,
    price,
    shippingCost,
    shippingKnown: shippingCost !== null,
    shippingCostType: text(first(shipping.shippingType)),
    landedPrice: shippingCost === null ? null : round(price + shippingCost),
    url,
    fixedPrice,
    queryUsed: query,
    seenInQueries: [query],
    discoveryLane: "finding_accounting",
    sourceLanes: ["finding_accounting"],
  };
}

async function searchFinding(query: string): Promise<{
  items: Json[];
  failure: SearchFailure | null;
}> {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) {
    return {
      items: [],
      failure: {
        query,
        status: null,
        message: "EBAY_CLIENT_ID is missing.",
      },
    };
  }

  const url = new URL(
    "https://svcs.ebay.com/services/search/FindingService/v1",
  );
  url.searchParams.set("OPERATION-NAME", "findItemsAdvanced");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", clientId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "");
  url.searchParams.set("GLOBAL-ID", "EBAY-US");
  url.searchParams.set("keywords", query);
  url.searchParams.set("paginationInput.entriesPerPage", String(MAX_RESULTS));

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return {
        items: [],
        failure: {
          query,
          status: response.status,
          message: (await response.text().catch(() => "")).slice(0, 300),
        },
      };
    }

    const payload = await response.json();
    const root = record(first(payload?.findItemsAdvancedResponse));
    const ack = String(first(root.ack) || "").toLowerCase();
    if (ack && ack !== "success" && ack !== "warning") {
      const message = list(root.errorMessage)
        .flatMap((entry) => list(record(entry).error))
        .map((entry) => text(first(record(entry).message)))
        .filter(Boolean)
        .join(" | ");
      return {
        items: [],
        failure: {
          query,
          status: response.status,
          message: message || `Finding API returned ${ack}.`,
        },
      };
    }

    const result = record(first(root.searchResult));
    return {
      items: list(result.item)
        .map((entry) => searchCandidate(entry, query))
        .filter((entry): entry is Json => Boolean(entry)),
      failure: null,
    };
  } catch (error) {
    return {
      items: [],
      failure: {
        query,
        status: null,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function mergeRawCandidates(values: Json[]): Json[] {
  const map = new Map<string, Json>();
  for (const value of values) {
    const id = canonicalActiveMarketCandidateId(value);
    const current = map.get(id);
    if (!current) {
      map.set(id, value);
      continue;
    }
    map.set(id, {
      ...current,
      ...value,
      seenInQueries: uniqueStrings([
        ...list(current.seenInQueries),
        current.queryUsed,
        ...list(value.seenInQueries),
        value.queryUsed,
      ]),
      sourceLanes: uniqueStrings([
        ...list(current.sourceLanes),
        current.discoveryLane,
        ...list(value.sourceLanes),
        value.discoveryLane,
      ]),
    });
  }
  return Array.from(map.values());
}

function targetIdentity(
  targetTitle: string,
  tracking: Json,
  fallbackPlayer: string | null,
): ActiveMarketTargetIdentity {
  const identity = record(tracking.identity);
  return {
    player: text(identity.player) || fallbackPlayer,
    year: text(identity.year),
    setName: text(identity.setName),
    parallel: text(identity.parallel),
    cardNumber: text(identity.cardNumber),
    printRun: printRun(identity.serialNumber) || printRun(targetTitle),
    isAuto: identity.isAuto === true || hasAuto(targetTitle),
    isRelic: identity.isRelic === true || hasRelic(targetTitle),
    isGraded:
      Boolean(identity.gradingCompany || identity.gradeValue) ||
      hasGrade(targetTitle),
  };
}

function receiptHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

export async function handleActiveMarketAttackWithAccountingGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithIntegrityGuard(
    request,
    context,
  );
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(
      payload || { error: "Active Market Attack Mode failed." },
      { status: baseResponse.status },
    );
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const account = await getAuthenticatedSellerAccountFromRequest(request);
  if (!account) return Response.json(payload, { status: baseResponse.status });
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const { inventoryItemId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,seller_account_id,title,metadata")
    .eq("id", inventoryItemId)
    .eq("store_id", storeId)
    .single();
  if (itemError || !item) {
    return Response.json(payload, { status: baseResponse.status });
  }
  if (
    !(
      item.seller_account_id === account.id ||
      (owner && item.seller_account_id === null)
    )
  ) {
    return Response.json(payload, { status: baseResponse.status });
  }

  let targetTitle = String(item.title || "");
  let ebayItemId: string | null = null;
  let fallbackPlayer: string | null = null;
  if (item.legacy_product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("title,ebay_item_id,player")
      .eq("id", item.legacy_product_id)
      .eq("store_id", storeId)
      .maybeSingle();
    targetTitle = targetTitle || String(product?.title || "");
    ebayItemId = text(product?.ebay_item_id);
    fallbackPlayer = text(product?.player);
  }

  const attack = record(tracking.activeMarketAttack || payload.attack);
  const queries = uniqueStrings(list(attack.searchQueries))
    .filter(
      (query) =>
        query.length >= 4 &&
        !/^ACTIVE MARKET /i.test(query) &&
        !/^Evidence accounted:/i.test(query),
    )
    .slice(0, MAX_QUERIES);
  const batches = await Promise.all(queries.map((query) => searchFinding(query)));
  const failures = batches
    .map((batch) => batch.failure)
    .filter((failure): failure is SearchFailure => Boolean(failure));
  const rawCandidates = mergeRawCandidates(
    batches.flatMap((batch) => batch.items),
  );
  const selfListing = record(attack.selfListing);
  const selfListingIds = uniqueStrings([
    ebayItemId,
    selfListing.legacyItemId,
    selfListing.itemId,
    selfListing.url,
  ]);
  const accounting = buildActiveMarketEvidenceAccounting({
    rawCandidates,
    attack,
    targetTitle,
    identity: targetIdentity(targetTitle, tracking, fallbackPlayer),
    selfListingIds,
    queriesAttempted: queries.length,
    queriesSucceeded: batches.length - failures.length,
    sourceFailures: failures,
  });
  const receipt = receiptHash({
    targetTitle,
    selfListingIds,
    queries,
    accounting: {
      checkedAt: accounting.checkedAt,
      counts: accounting.counts,
      ledger: accounting.ledger,
    },
  });
  const accountingMessage = accounting.passed
    ? `ACTIVE MARKET EVIDENCE ACCOUNTING PASSED: ${accounting.summary} Receipt ${receipt}.`
    : `ACTIVE MARKET EVIDENCE ACCOUNTING BLOCKED: ${accounting.failures.join(
        "; ",
      )}. ${accounting.summary} Receipt ${receipt}.`;
  const baseTax =
    stripOldAccountingNote(attack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const marketLabel = String(record(attack.marketLocation).label || "US estimate")
    .replace(/\s*·\s*accounted\s+\d+[\s\S]*$/i, "")
    .trim();
  const blocked = !accounting.passed;
  const nextAttack: Json = {
    ...attack,
    schema: "truely.activeMarketAttack.v12",
    evidenceAccountingVersion: "active-market-evidence-accounting-v1",
    evidenceAccounting: accounting,
    evidenceAccountingReceipt: receipt,
    evidenceAccountingPassed: accounting.passed,
    evidenceAccountingCheckedAt: accounting.checkedAt,
    accountedExternalCandidateCount: accounting.externalCandidateCount,
    identityRejectedCount: accounting.counts.identityRejected,
    auctionOnlyCount: accounting.counts.auctionOnly,
    taxNote: `${baseTax} ${accountingMessage}`,
    marketLocation: {
      ...record(attack.marketLocation),
      label: `${marketLabel} · accounted ${accounting.externalCandidateCount} = ${accounting.counts.verifiedPricing} verified + ${accounting.counts.scouting} scout + ${accounting.counts.packagingRejected} packaging + ${accounting.counts.identityRejected} identity + ${accounting.counts.auctionOnly} auction`,
    },
    marketIntegrityStatus: blocked
      ? "blocked"
      : attack.marketIntegrityStatus || "complete",
    ...(blocked
      ? {
          suggestions: [],
          lowestCompetitor: null,
          lowestCompetitorLanded: null,
          gapToLowest: null,
          position: "evidence_accounting_blocked",
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons
        .map(String)
        .filter(
          (reason: string) =>
            reason !== "active_market_evidence_accounting_passed" &&
            reason !== "active_market_evidence_accounting_blocked" &&
            reason !== "active_market_evidence_accounting_source_warning",
        )
    : [];
  const nextTracking: Json = {
    ...tracking,
    activeMarketAttack: nextAttack,
    trustedForPricing:
      !blocked && tracking.trustedForPricing === true,
    marketPrice: blocked ? null : tracking.marketPrice ?? null,
    deltaAmount: blocked ? null : tracking.deltaAmount ?? null,
    deltaPercent: blocked ? null : tracking.deltaPercent ?? null,
    pricingEvidenceMode: blocked
      ? "active_market_evidence_accounting_blocked"
      : tracking.pricingEvidenceMode,
    reviewReasons: uniqueStrings([
      ...existingReasons,
      accounting.passed
        ? "active_market_evidence_accounting_passed"
        : "active_market_evidence_accounting_blocked",
      ...(accounting.warnings.length
        ? ["active_market_evidence_accounting_source_warning"]
        : []),
    ]),
    evidenceAccounting: accounting,
    evidenceAccountingReceipt: receipt,
    updatedAt: nextAttack.updatedAt,
  };

  const metadata = record(item.metadata);
  const root = record(metadata.instacomp_tracking);
  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      metadata: {
        ...metadata,
        instacomp_tracking: {
          ...root,
          schema: "truely.instacompInventoryTrackingHistory.v12",
          current: nextTracking,
        },
      },
      updated_at: nextTracking.updatedAt,
    })
    .eq("id", inventoryItemId)
    .eq("store_id", storeId);
  if (updateError) throw updateError;

  return Response.json({
    ...payload,
    tracking: nextTracking,
    attack: nextAttack,
    mode: blocked ? "active_market_evidence_accounting_blocked" : payload.mode,
    diagnostics: {
      ...record(payload.diagnostics),
      evidenceAccountingPassed: accounting.passed,
      evidenceAccountingFailures: accounting.failures,
      evidenceAccountingWarnings: accounting.warnings,
      evidenceAccountingCounts: accounting.counts,
      evidenceAccountingReceipt: receipt,
      accountedExternalCandidateCount: accounting.externalCandidateCount,
    },
  });
}
