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

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function arr(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(rec) : [];
}

function txt(value: unknown): string | null {
  const result = String(value || "").trim();
  return result || null;
}

function cash(value: unknown, allowZero = false): number | null {
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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function packagingState(value: unknown): PackagingState {
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

function key(candidate: Json): string {
  return String(
    candidate.legacyItemId ||
      candidate.itemId ||
      candidate.url ||
      candidate.title ||
      JSON.stringify(candidate),
  );
}

function dedupe(values: Json[]): Json[] {
  const map = new Map<string, Json>();
  for (const value of values) {
    const candidateKey = key(value);
    const current = map.get(candidateKey);
    if (!current || Number(value.matchScore || 0) > Number(current.matchScore || 0)) {
      map.set(candidateKey, value);
    }
  }
  return Array.from(map.values());
}

function charm(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}

function strategy(
  keyName: string,
  label: string,
  targetLanded: number,
  shipping: number,
  profitFloor: number | null,
): Json {
  const itemPrice = charm(Math.max(0.99, targetLanded - shipping));
  return {
    key: keyName,
    label,
    itemPrice,
    shipping,
    landedPrice: round(itemPrice + shipping),
    profitFloor,
    meetsProfitFloor: profitFloor === null ? null : itemPrice >= profitFloor,
  };
}

function correctPackaging(attack: Json, targetTitle: string): Json {
  const titleState = packagingState(targetTitle);
  const targetState: PackagingState =
    titleState !== "unknown"
      ? titleState
      : attack.packagingState === "sealed" || attack.packagingState === "opened"
        ? attack.packagingState
        : "unknown";
  const verified: Json[] = [];
  const scouting: Json[] = [];
  const rejected: Json[] = [...arr(attack.packagingRejectedCandidates)];
  let rippedRejectedCount = 0;

  for (const candidate of dedupe([
    ...arr(attack.competitors),
    ...arr(attack.scoutingCandidates),
  ])) {
    const state = packagingState(candidate.title);
    if (targetState !== "unknown" && state !== "unknown" && state !== targetState) {
      rejected.push({
        ...candidate,
        packagingState: state,
        rejectionReason: `${state.toUpperCase()} product state conflicts with ${targetState.toUpperCase()} target`,
      });
      if (/\bripped\b/i.test(String(candidate.title || ""))) rippedRejectedCount += 1;
      continue;
    }

    const fixedPrice = candidate.fixedPrice !== false;
    const matchLevel = String(candidate.matchLevel || "scouting");
    if (
      targetState !== "unknown" &&
      state === targetState &&
      fixedPrice &&
      (matchLevel === "exact" || matchLevel === "strong")
    ) {
      verified.push({
        ...candidate,
        packagingState: state,
        flags: uniqueStrings([
          ...arr(candidate.flags),
          `${targetState} packaging confirmed`,
        ]),
      });
      continue;
    }

    scouting.push({
      ...candidate,
      matchLevel: "scouting",
      packagingState: state,
      flags: uniqueStrings([
        ...arr(candidate.flags),
        ...(state === "unknown" && targetState !== "unknown"
          ? [`packaging state not stated; ${targetState} required`]
          : []),
        ...(!fixedPrice ? ["auction — review only"] : []),
      ]),
    });
  }

  const competitors = dedupe(verified).sort((left, right) => {
    const leftLanded = cash(left.landedPrice, true);
    const rightLanded = cash(right.landedPrice, true);
    if (leftLanded !== null && rightLanded !== null) return leftLanded - rightLanded;
    if (leftLanded !== null) return -1;
    if (rightLanded !== null) return 1;
    return Number(right.matchScore || 0) - Number(left.matchScore || 0);
  });
  const scouts = dedupe(scouting)
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0))
    .slice(0, 12);
  const conflicts = dedupe(rejected).slice(0, 30);
  const known = competitors.filter((candidate) => cash(candidate.landedPrice, true) !== null);
  const lowest = known[0] || null;
  const lowestLanded = lowest ? cash(lowest.landedPrice, true) : null;
  const ourItemPrice = Number(attack.ourItemPrice || 0);
  const ourShipping = Number(attack.ourShipping || 0);
  const ourLanded = round(ourItemPrice + ourShipping);
  const floorValue = Number(attack.profitFloor);
  const profitFloor = Number.isFinite(floorValue) ? floorValue : null;
  const gap = lowestLanded === null ? null : round(ourLanded - lowestLanded);
  const position =
    lowestLanded === null
      ? competitors.length
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
          strategy("beat_by_cent", "Beat by $0.01", lowestLanded - 0.01, ourShipping, profitFloor),
          strategy("beat_by_dollar", "Beat by $1", lowestLanded - 1, ourShipping, profitFloor),
          strategy("undercut_5", "5% lower landed", lowestLanded * 0.95, ourShipping, profitFloor),
          strategy("undercut_10", "10% lower landed — King Price", lowestLanded * 0.9, ourShipping, profitFloor),
          strategy("undercut_15", "15% lower landed — Aggressive", lowestLanded * 0.85, ourShipping, profitFloor),
        ];
  const unknownCount = scouts.filter(
    (candidate) => candidate.packagingState === "unknown",
  ).length;

  return {
    ...attack,
    schema: "truely.activeMarketAttack.v10",
    packagingRuleVersion: "ripped-unripped-v1",
    packagingState: targetState,
    packagingExactCount: competitors.length,
    packagingUnknownCount: unknownCount,
    packagingRejectedCount: conflicts.length,
    packagingRejectedCandidates: conflicts,
    rippedRejectedCount,
    status: competitors.length ? "ready" : scouts.length ? "scouting_only" : "no_candidates",
    exactActiveCount: competitors.length,
    strictExactCount: competitors.filter((candidate) => candidate.matchLevel === "exact").length,
    strongMatchCount: competitors.filter((candidate) => candidate.matchLevel === "strong").length,
    scoutingCount: scouts.length,
    landedKnownCount: known.length,
    shippingUnknownCount: competitors.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowestLanded,
    ourLanded,
    position,
    gapToLowest: gap,
    suggestions,
    competitors: competitors.slice(0, 10),
    scoutingCandidates: scouts,
  };
}

async function verifySelf(ebayItemId: string | null, attack: Json): Promise<Json> {
  const existing = rec(attack.selfListing);
  const existingConfirmed = attack.selfResolved === true && Boolean(txt(existing.title));
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
      const payload: any = await response.json().catch(() => null);
      const item = rec(payload?.Item);
      const ack = String(payload?.Ack || "").toLowerCase();
      const status = String(item.ListingStatus || "").toLowerCase();
      const title = txt(item.Title);
      const price =
        cash(rec(item.ConvertedCurrentPrice).Value) ||
        cash(rec(item.CurrentPrice).Value);
      const shippingCost = cash(
        rec(rec(item.ShippingCostSummary).ShippingServiceCost).Value,
        true,
      );
      const itemUrl =
        txt(item.ViewItemURLForNaturalSearch) ||
        txt(item.ViewItemURL) ||
        `https://www.ebay.com/itm/${ebayItemId}`;

      if (
        response.ok &&
        (ack === "success" || ack === "warning") &&
        (!status || status === "active") &&
        title &&
        price !== null
      ) {
        return {
          confirmed: true,
          source: "shopping_api",
          listing: {
            legacyItemId: ebayItemId,
            itemId: ebayItemId,
            title,
            price,
            shippingCost,
            shippingKnown: shippingCost !== null,
            shippingCostType: "Shopping API",
            landedPrice: shippingCost === null ? null : round(price + shippingCost),
            url: itemUrl,
            listingStatus: item.ListingStatus || "Active",
            packagingState: packagingState(title),
            source: "ebay_shopping_api",
            sourceLabel: "Your eBay listing",
          },
          message: `YOUR EBAY LISTING CONFIRMED: item ${ebayItemId}, “${title}” at $${price.toFixed(2)}. It is excluded from competitor counts and pricing.`,
        };
      }
    } catch {
      // Fall back to the existing Browse self lookup below.
    }
  }

  if (existingConfirmed) {
    const id = txt(existing.legacyItemId) || txt(existing.itemId) || ebayItemId || "unknown";
    return {
      confirmed: true,
      source: "browse_api",
      listing: existing,
      message: `YOUR EBAY LISTING CONFIRMED: item ${id}, “${
        txt(existing.title) || "title unavailable"
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

function stripOldSelfNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*YOUR EBAY LISTING (?:CONFIRMED|NOT CONFIRMED):[\s\S]*$/i, "")
    .trim();
}

export async function handleActiveMarketAttackWithProofGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithFindingGuard(request, context);
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(payload || { error: "Active Market Attack Mode failed." }, {
      status: baseResponse.status,
    });
  }

  const tracking = rec(payload.tracking);
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
    ebayItemId = txt(product?.ebay_item_id);
  }

  const corrected = correctPackaging(
    rec(tracking.activeMarketAttack || payload.attack),
    targetTitle,
  );
  const self = await verifySelf(ebayItemId, corrected);
  const externalCount = Number(
    corrected.externalRawCandidateCount ?? corrected.rawCandidateCount ?? 0,
  );
  const selfStatus = self.confirmed
    ? `YOUR EBAY LISTING CONFIRMED #${ebayItemId || "unknown"}`
    : `YOUR EBAY LISTING NOT CONFIRMED #${ebayItemId || "missing"}`;
  const baseTax =
    stripOldSelfNote(corrected.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const nextAttack: Json = {
    ...corrected,
    selfResolved: self.confirmed === true,
    selfListing: self.listing,
    selfListingProofSource: self.source,
    selfListingProofMessage: self.message,
    marketIntegrityStatus: self.confirmed ? "complete" : "incomplete",
    taxNote: `${baseTax} ${self.message}`,
    marketLocation: {
      ...rec(corrected.marketLocation),
      label: `Denver shipping estimate · external ${externalCount} · packaging rejected ${Number(
        corrected.packagingRejectedCount || 0,
      )} · unknown ${Number(corrected.packagingUnknownCount || 0)} · ${selfStatus}`,
    },
    updatedAt: new Date().toISOString(),
  };
  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons.map(String).filter(
        (reason: string) =>
          reason !== "active_market_self_listing_confirmed" &&
          reason !== "active_market_self_listing_not_confirmed",
      )
    : [];
  const nextTracking = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: nextAttack.exactActiveCount,
    trustedForPricing: self.confirmed && Number(nextAttack.exactActiveCount || 0) > 0,
    marketPrice: null,
    deltaAmount: null,
    deltaPercent: null,
    pricingEvidenceMode:
      Number(nextAttack.exactActiveCount || 0) > 0
        ? "active_market_attack"
        : Number(nextAttack.scoutingCount || 0) > 0
          ? "active_market_scouting"
          : "active_market_no_results",
    reviewReasons: uniqueStrings([
      ...existingReasons,
      self.confirmed
        ? "active_market_self_listing_confirmed"
        : "active_market_self_listing_not_confirmed",
      ...(Number(nextAttack.packagingRejectedCount || 0) > 0
        ? ["active_market_packaging_conflicts_removed"]
        : []),
    ]),
    topMarketComps: nextAttack.competitors,
    updatedAt: nextAttack.updatedAt,
  };

  const metadata = rec(item.metadata);
  const root = rec(metadata.instacomp_tracking);
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
      ...rec(payload.diagnostics),
      packagingRuleVersion: nextAttack.packagingRuleVersion,
      packagingRejectedCount: nextAttack.packagingRejectedCount,
      packagingUnknownCount: nextAttack.packagingUnknownCount,
      packagingExactCount: nextAttack.packagingExactCount,
      rippedRejectedCount: nextAttack.rippedRejectedCount,
      selfListingConfirmed: self.confirmed === true,
      selfListingProofSource: self.source,
      selfListingId: ebayItemId,
      marketIntegrityStatus: nextAttack.marketIntegrityStatus,
    },
  });
}
