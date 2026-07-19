import "server-only";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { handleActiveMarketAttackWithFindingGuard } from "./active-market-finding-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

type Json = Record<string, any>;
type PackagingState = "sealed" | "opened" | "unknown";

type SelfProof = {
  confirmed: boolean;
  source: "shopping_api" | "browse_api" | "none";
  listing: Json | null;
  message: string;
};

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const text = (value: unknown): string | null => {
  const result = String(value || "").trim();
  return result || null;
};
const money = (value: unknown, allowZero = false): number | null => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) {
    return null;
  }
  return Math.round(result * 100) / 100;
};
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const normalize = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const unique = (values: unknown[]) =>
  Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );

/**
 * Frozen in Ice uses RIPPED / UNRIPPED as the product-state language.
 * Those words are first-class packaging evidence, not generic title noise.
 */
export function precisePackagingState(value: unknown): PackagingState {
  const input = normalize(value);
  if (!input) return "unknown";

  if (
    /\b(unripped|un ripped|not ripped|never ripped|unopened|not opened|never opened|factory sealed|still sealed|sealed|seal intact|intact seal|still in wrapper|wrapper intact)\b/.test(
      input,
    )
  ) {
    return "sealed";
  }

  if (
    /\b(ripped|rip card|rip revealed|opened|open card|unsealed|seal broken|broken seal|cracked open|revealed|removed from sealed|removed from wrapper|pulled from wrapper)\b/.test(
      input,
    )
  ) {
    return "opened";
  }

  return "unknown";
}

function candidateKey(candidate: Json) {
  return String(
    candidate.legacyItemId ||
      candidate.itemId ||
      candidate.url ||
      candidate.title ||
      JSON.stringify(candidate),
  );
}

function dedupe(values: Json[]) {
  const map = new Map<string, Json>();
  for (const value of values) {
    const key = candidateKey(value);
    const current = map.get(key);
    if (!current || Number(value.matchScore || 0) > Number(current.matchScore || 0)) {
      map.set(key, value);
    }
  }
  return Array.from(map.values());
}

function charm(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}

function suggestion(
  key: string,
  label: string,
  target: number,
  shipping: number,
  floor: number | null,
) {
  const itemPrice = charm(Math.max(0.99, target - shipping));
  return {
    key,
    label,
    itemPrice,
    shipping,
    landedPrice: round(itemPrice + shipping),
    profitFloor: floor,
    meetsProfitFloor: floor === null ? null : itemPrice >= floor,
  };
}

function reclassifyPackaging(attack: Json, targetTitle: string) {
  const targetState =
    precisePackagingState(targetTitle) === "unknown"
      ? (String(attack.packagingState || "unknown") as PackagingState)
      : precisePackagingState(targetTitle);
  const previousRejected = list(attack.packagingRejectedCandidates).map(record);
  const allCandidates = dedupe([
    ...list(attack.competitors).map(record),
    ...list(attack.scoutingCandidates).map(record),
  ]);
  const verified: Json[] = [];
  const scouting: Json[] = [];
  const rejected: Json[] = [...previousRejected];
  let rippedRejectedCount = 0;

  for (const candidate of allCandidates) {
    const packagingState = precisePackagingState(candidate.title);
    if (
      targetState !== "unknown" &&
      packagingState !== "unknown" &&
      packagingState !== targetState
    ) {
      rejected.push({
        ...candidate,
        packagingState,
        rejectionReason: `${packagingState.toUpperCase()} product state conflicts with ${targetState.toUpperCase()} target`,
      });
      if (/\bripped\b/i.test(String(candidate.title || ""))) rippedRejectedCount += 1;
      continue;
    }

    if (targetState !== "unknown" && packagingState === "unknown") {
      scouting.push({
        ...candidate,
        matchLevel: "scouting",
        packagingState,
        flags: unique([
          ...list(candidate.flags),
          `packaging state not stated; ${targetState} required`,
        ]),
      });
      continue;
    }

    const fixedPrice = candidate.fixedPrice !== false;
    const matchLevel = String(candidate.matchLevel || "scouting");
    if (!fixedPrice || matchLevel === "scouting") {
      scouting.push({
        ...candidate,
        matchLevel: "scouting",
        packagingState,
        flags: unique([
          ...list(candidate.flags),
          ...(fixedPrice ? [] : ["auction — review only"]),
        ]),
      });
      continue;
    }

    verified.push({
      ...candidate,
      packagingState,
      flags: unique([
        ...list(candidate.flags),
        targetState === "unknown"
          ? "packaging not required"
          : `${targetState} packaging confirmed`,
      ]),
    });
  }

  const exact = dedupe(verified).sort((left, right) => {
    const leftLanded = money(left.landedPrice, true);
    const rightLanded = money(right.landedPrice, true);
    if (leftLanded !== null && rightLanded !== null) return leftLanded - rightLanded;
    if (leftLanded !== null) return -1;
    if (rightLanded !== null) return 1;
    return Number(right.matchScore || 0) - Number(left.matchScore || 0);
  });
  const review = dedupe(scouting)
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0))
    .slice(0, 12);
  const conflicts = dedupe(rejected).slice(0, 30);
  const known = exact.filter((candidate) => money(candidate.landedPrice, true) !== null);
  const lowest = known[0] || null;
  const lowestLanded = lowest ? money(lowest.landedPrice, true) : null;
  const ourItemPrice = Number(attack.ourItemPrice || 0);
  const ourShipping = Number(attack.ourShipping || 0);
  const ourLanded = round(ourItemPrice + ourShipping);
  const rawFloor = attack.profitFloor;
  const floor =
    rawFloor === null || rawFloor === undefined || !Number.isFinite(Number(rawFloor))
      ? null
      : Number(rawFloor);
  const gap = lowestLanded === null ? null : round(ourLanded - lowestLanded);
  const position =
    lowestLanded === null
      ? exact.length
        ? "shipping_unknown"
        : "no_verified_matches"
      : ourLanded < lowestLanded
        ? "best_deal"
        : ourLanded <= lowestLanded + 1
          ? "within_striking_distance"
          : "over_market";
  const suggestions =
    lowestLanded === null
      ? []
      : [
          suggestion("beat_by_cent", "Beat by $0.01", lowestLanded - 0.01, ourShipping, floor),
          suggestion("beat_by_dollar", "Beat by $1", lowestLanded - 1, ourShipping, floor),
          suggestion("undercut_5", "5% lower landed", lowestLanded * 0.95, ourShipping, floor),
          suggestion("undercut_10", "10% lower landed — King Price", lowestLanded * 0.9, ourShipping, floor),
          suggestion("undercut_15", "15% lower landed — Aggressive", lowestLanded * 0.85, ourShipping, floor),
        ];
  const unknownCount = review.filter(
    (candidate) => candidate.packagingState === "unknown",
  ).length;

  return {
    ...attack,
    schema: "truely.activeMarketAttack.v10",
    packagingRuleVersion: "ripped-unripped-v1",
    packagingState: targetState,
    packagingExactCount: exact.length,
    packagingUnknownCount: unknownCount,
    packagingRejectedCount: conflicts.length,
    packagingRejectedCandidates: conflicts,
    rippedRejectedCount,
    status: exact.length ? "ready" : review.length ? "scouting_only" : "no_candidates",
    exactActiveCount: exact.length,
    strictExactCount: exact.filter((candidate) => candidate.matchLevel === "exact").length,
    strongMatchCount: exact.filter((candidate) => candidate.matchLevel === "strong").length,
    scoutingCount: review.length,
    landedKnownCount: known.length,
    shippingUnknownCount: exact.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowestLanded,
    ourLanded,
    position,
    gapToLowest: gap,
    suggestions,
    competitors: exact.slice(0, 10),
    scoutingCandidates: review,
  };
}

async function verifyOwnListing(
  ebayItemId: string | null,
  existingAttack: Json,
): Promise<SelfProof> {
  const existing = record(existingAttack.selfListing);
  const existingResolved = existingAttack.selfResolved === true && text(existing.title);
  const clientId = process.env.EBAY_CLIENT_ID;

  if (ebayItemId && clientId) {
    const url = new URL("https://open.api.ebay.com/shopping");
    url.searchParams.set("callname", "GetSingleItem");
    url.searchParams.set("responseencoding", "JSON");
    url.searchParams.set("appid", clientId);
    url.searchParams.set("siteid", "0");
    url.searchParams.set("version", "967");
    url.searchParams.set("ItemID", ebayItemId);
    url.searchParams.set("IncludeSelector", "Details,ShippingCosts");

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json().catch(() => null);
      const ack = String(payload?.Ack || "").toLowerCase();
      const item = record(payload?.Item);
      const listingStatus = String(item.ListingStatus || "").toLowerCase();
      const title = text(item.Title);
      const price =
        money(record(item.ConvertedCurrentPrice).Value) ||
        money(record(item.CurrentPrice).Value);
      const shippingCost = money(
        record(record(item.ShippingCostSummary).ShippingServiceCost).Value,
        true,
      );
      const listingUrl =
        text(item.ViewItemURLForNaturalSearch) ||
        text(item.ViewItemURL) ||
        `https://www.ebay.com/itm/${ebayItemId}`;
      const active = !listingStatus || listingStatus === "active";

      if (
        response.ok &&
        (ack === "success" || ack === "warning") &&
        title &&
        price !== null &&
        active
      ) {
        const listing = {
          legacyItemId: ebayItemId,
          itemId: ebayItemId,
          title,
          price,
          shippingCost,
          shippingKnown: shippingCost !== null,
          shippingCostType: "Shopping API",
          landedPrice: shippingCost === null ? null : round(price + shippingCost),
          url: listingUrl,
          listingStatus: item.ListingStatus || "Active",
          packagingState: precisePackagingState(title),
          source: "ebay_shopping_api",
          sourceLabel: "Your eBay listing",
        };
        return {
          confirmed: true,
          source: "shopping_api",
          listing,
          message: `YOUR EBAY LISTING CONFIRMED: item ${ebayItemId}, “${title}” at $${price.toFixed(2)}. It is excluded from competitor counts and pricing.`,
        };
      }

      const errors = list(payload?.Errors)
        .map(record)
        .map((error) => text(error.LongMessage) || text(error.ShortMessage))
        .filter(Boolean)
        .join(" | ");
      if (!existingResolved) {
        return {
          confirmed: false,
          source: "none",
          listing: null,
          message: `YOUR EBAY LISTING NOT CONFIRMED: item ${ebayItemId}. Shopping API response was ${response.status}${
            errors ? ` — ${errors}` : ""
          }. Treat this scan as incomplete.`,
        };
      }
    } catch (error: any) {
      if (!existingResolved) {
        return {
          confirmed: false,
          source: "none",
          listing: null,
          message: `YOUR EBAY LISTING NOT CONFIRMED: item ${ebayItemId}. ${
            error?.message || "The independent listing check failed."
          } Treat this scan as incomplete.`,
        };
      }
    }
  }

  if (existingResolved) {
    const legacyItemId =
      text(existing.legacyItemId) || text(existing.itemId) || ebayItemId || "unknown";
    return {
      confirmed: true,
      source: "browse_api",
      listing: existing,
      message: `YOUR EBAY LISTING CONFIRMED: item ${legacyItemId}, “${
        text(existing.title) || "title unavailable"
      }”. It is excluded from competitor counts and pricing.`,
    };
  }

  return {
    confirmed: false,
    source: "none",
    listing: null,
    message: ebayItemId
      ? `YOUR EBAY LISTING NOT CONFIRMED: item ${ebayItemId}. Treat this scan as incomplete.`
      : "YOUR EBAY LISTING NOT CONFIRMED: no stored eBay item ID was available. Treat this scan as incomplete.",
  };
}

function cleanSelfProofNote(value: unknown) {
  return String(value || "")
    .replace(/\s*YOUR EBAY LISTING (?:CONFIRMED|NOT CONFIRMED):[\s\S]*$/i, "")
    .trim();
}

export async function handleActiveMarketAttackWithProofGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithFindingGuard(request, context);
  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(payload || { error: "Active Market Attack Mode failed." }, {
      status: baseResponse.status,
    });
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const account = await getAuthenticatedAccountFromRequest(request);
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
  if (itemError || !item) return Response.json(payload, { status: baseResponse.status });
  if (!(item.seller_account_id === account.id || (owner && item.seller_account_id === null))) {
    return Response.json(payload, { status: baseResponse.status });
  }

  let targetTitle = String(item.title || "");
  let ebayItemId: string | null = null;
  if (item.legacy_product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("title,ebay_item_id")
      .eq("id", item.legacy_product_id)
      .eq("store_id", storeId)
      .maybeSingle();
    targetTitle = targetTitle || String(product?.title || "");
    ebayItemId = text(product?.ebay_item_id);
  }

  const originalAttack = record(tracking.activeMarketAttack || payload.attack);
  const correctedAttack = reclassifyPackaging(originalAttack, targetTitle);
  const selfProof = await verifyOwnListing(ebayItemId, correctedAttack);
  const baseTaxNote =
    cleanSelfProofNote(correctedAttack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const externalCount = Number(
    correctedAttack.externalRawCandidateCount ?? correctedAttack.rawCandidateCount ?? 0,
  );
  const ownStatus = selfProof.confirmed
    ? `YOUR EBAY LISTING CONFIRMED #${ebayItemId || "unknown"}`
    : `YOUR EBAY LISTING NOT CONFIRMED #${ebayItemId || "missing"}`;
  const nextAttack = {
    ...correctedAttack,
    selfResolved: selfProof.confirmed,
    selfListing: selfProof.listing,
    selfListingProofSource: selfProof.source,
    selfListingProofMessage: selfProof.message,
    marketIntegrityStatus: selfProof.confirmed ? "complete" : "incomplete",
    taxNote: `${baseTaxNote} ${selfProof.message}`,
    marketLocation: {
      ...record(correctedAttack.marketLocation),
      label: `Denver shipping estimate · external ${externalCount} · packaging rejected ${Number(
        correctedAttack.packagingRejectedCount || 0,
      )} · unknown ${Number(correctedAttack.packagingUnknownCount || 0)} · ${ownStatus}`,
    },
    updatedAt: new Date().toISOString(),
  };

  const existingReasons = list(tracking.reviewReasons)
    .map(String)
    .filter(
      (reason) =>
        reason !== "active_market_self_listing_confirmed" &&
        reason !== "active_market_self_listing_not_confirmed",
    );
  const nextTracking = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: nextAttack.exactActiveCount,
    trustedForPricing:
      selfProof.confirmed && Number(nextAttack.exactActiveCount || 0) > 0,
    marketPrice: null,
    deltaAmount: null,
    deltaPercent: null,
    pricingEvidenceMode:
      Number(nextAttack.exactActiveCount || 0) > 0
        ? "active_market_attack"
        : Number(nextAttack.scoutingCount || 0) > 0
          ? "active_market_scouting"
          : "active_market_no_results",
    reviewReasons: unique([
      ...existingReasons,
      selfProof.confirmed
        ? "active_market_self_listing_confirmed"
        : "active_market_self_listing_not_confirmed",
      ...(Number(nextAttack.packagingRejectedCount || 0) > 0
        ? ["active_market_packaging_conflicts_removed"]
        : []),
    ]),
    topMarketComps: nextAttack.competitors,
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
          schema: "truely.instacompInventoryTrackingHistory.v10",
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
    mode:
      Number(nextAttack.exactActiveCount || 0) > 0
        ? "active_market_attack"
        : Number(nextAttack.scoutingCount || 0) > 0
          ? "active_market_scouting"
          : "no_exact_active_market",
    diagnostics: {
      ...record(payload.diagnostics),
      packagingRuleVersion: nextAttack.packagingRuleVersion,
      packagingRejectedCount: nextAttack.packagingRejectedCount,
      packagingUnknownCount: nextAttack.packagingUnknownCount,
      packagingExactCount: nextAttack.packagingExactCount,
      rippedRejectedCount: nextAttack.rippedRejectedCount,
      selfListingConfirmed: selfProof.confirmed,
      selfListingProofSource: selfProof.source,
      selfListingId: ebayItemId,
      marketIntegrityStatus: nextAttack.marketIntegrityStatus,
    },
  });
}
