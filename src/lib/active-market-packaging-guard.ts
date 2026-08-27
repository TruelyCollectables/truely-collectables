import "server-only";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { handleActiveMarketAttack } from "./active-market-attack-server";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

type Json = Record<string, unknown>;
type PackagingState = "sealed" | "opened" | "unknown";

type Candidate = Json & {
  title?: string;
  price?: number;
  shippingCost?: number | null;
  landedPrice?: number | null;
  url?: string;
  matchLevel?: string;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectiblePackagingState(value: unknown): PackagingState {
  const text = normalize(value);
  if (!text) return "unknown";

  // Opened/unsealed must be checked before sealed because "unsealed" contains "sealed".
  if (
    /\b(open|opened|unsealed|seal broken|broken seal|cracked open|revealed|removed from sealed|removed from wrapper|opened card|open card)\b/.test(
      text,
    )
  ) {
    return "opened";
  }

  if (
    /\b(sealed|factory sealed|still sealed|unopened|never opened|intact seal|seal intact)\b/.test(
      text,
    )
  ) {
    return "sealed";
  }

  return "unknown";
}

function candidateKey(candidate: Candidate) {
  return String(candidate.url || candidate.title || JSON.stringify(candidate));
}

function dedupeCandidates(values: Candidate[]) {
  const map = new Map<string, Candidate>();
  for (const value of values) {
    const key = candidateKey(value);
    const existing = map.get(key);
    if (!existing || Number(value.matchScore || 0) > Number(existing.matchScore || 0)) {
      map.set(key, value);
    }
  }
  return Array.from(map.values());
}

function charmBelow(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, roundMoney(Math.floor(maximum - 0.99) + 0.99));
}

function suggestion(params: {
  key: string;
  label: string;
  targetLanded: number;
  shipping: number;
  profitFloor: number | null;
}) {
  const itemPrice = charmBelow(Math.max(0.99, params.targetLanded - params.shipping));
  return {
    key: params.key,
    label: params.label,
    itemPrice,
    shipping: params.shipping,
    landedPrice: roundMoney(itemPrice + params.shipping),
    profitFloor: params.profitFloor,
    meetsProfitFloor:
      params.profitFloor === null ? null : itemPrice >= params.profitFloor,
  };
}

function correctedAttack(params: {
  attack: Json;
  targetState: Exclude<PackagingState, "unknown">;
}) {
  const verified = array(params.attack.competitors).map(record) as Candidate[];
  const existingScouting = array(params.attack.scoutingCandidates).map(record) as Candidate[];
  const kept: Candidate[] = [];
  const movedToScouting: Candidate[] = [];
  const rejected: Candidate[] = [];
  const oppositeState = params.targetState === "sealed" ? "opened" : "sealed";

  for (const candidate of verified) {
    const state = collectiblePackagingState(candidate.title);
    if (state === params.targetState) {
      kept.push({
        ...candidate,
        packagingState: state,
        flags: Array.from(
          new Set([
            ...array(candidate.flags).map(String),
            `${params.targetState} packaging confirmed`,
          ]),
        ),
      });
    } else if (state === "unknown") {
      movedToScouting.push({
        ...candidate,
        matchLevel: "scouting",
        packagingState: state,
        flags: Array.from(
          new Set([
            ...array(candidate.flags).map(String),
            `packaging state not stated; ${params.targetState} required`,
          ]),
        ),
      });
    } else {
      rejected.push({ ...candidate, packagingState: state });
    }
  }

  const guardedScouting = existingScouting
    .map((candidate) => ({
      ...candidate,
      packagingState: collectiblePackagingState(candidate.title),
    }))
    .filter((candidate) => candidate.packagingState !== oppositeState);

  const scouting = dedupeCandidates([...guardedScouting, ...movedToScouting]);
  const sorted = kept.sort((left, right) => {
    const leftLanded = Number(left.landedPrice);
    const rightLanded = Number(right.landedPrice);
    if (Number.isFinite(leftLanded) && Number.isFinite(rightLanded)) {
      return leftLanded - rightLanded;
    }
    if (Number.isFinite(leftLanded)) return -1;
    if (Number.isFinite(rightLanded)) return 1;
    return Number(left.price || 0) - Number(right.price || 0);
  });

  const known = sorted.filter((candidate) => Number.isFinite(Number(candidate.landedPrice)));
  const lowest = known[0] || null;
  const ourItemPrice = Number(params.attack.ourItemPrice || 0);
  const ourShipping = Number(params.attack.ourShipping || 0);
  const ourLanded = roundMoney(ourItemPrice + ourShipping);
  const rawProfitFloor = params.attack.profitFloor;
  const profitFloor =
    rawProfitFloor === null || rawProfitFloor === undefined
      ? null
      : Number.isFinite(Number(rawProfitFloor))
        ? Number(rawProfitFloor)
        : null;
  const lowestLanded = lowest ? Number(lowest.landedPrice) : null;
  const gap = lowestLanded === null ? null : roundMoney(ourLanded - lowestLanded);
  const position =
    lowestLanded === null
      ? sorted.length
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
          suggestion({
            key: "beat_by_cent",
            label: "Beat by $0.01",
            targetLanded: lowestLanded - 0.01,
            shipping: ourShipping,
            profitFloor,
          }),
          suggestion({
            key: "beat_by_dollar",
            label: "Beat by $1",
            targetLanded: lowestLanded - 1,
            shipping: ourShipping,
            profitFloor,
          }),
          suggestion({
            key: "undercut_5",
            label: "5% lower landed",
            targetLanded: lowestLanded * 0.95,
            shipping: ourShipping,
            profitFloor,
          }),
          suggestion({
            key: "undercut_10",
            label: "10% lower landed — King Price",
            targetLanded: lowestLanded * 0.9,
            shipping: ourShipping,
            profitFloor,
          }),
          suggestion({
            key: "undercut_15",
            label: "15% lower landed — Aggressive",
            targetLanded: lowestLanded * 0.85,
            shipping: ourShipping,
            profitFloor,
          }),
        ];

  return {
    ...params.attack,
    schema: "truely.activeMarketAttack.v6",
    packagingState: params.targetState,
    packagingRule: `${params.targetState.toUpperCase()} listings only may drive pricing`,
    packagingExactCount: sorted.length,
    packagingUnknownCount: movedToScouting.length,
    packagingRejectedCount: rejected.length,
    packagingRejectedStates: Array.from(
      new Set(rejected.map((candidate) => String(candidate.packagingState))),
    ),
    status: sorted.length ? "ready" : scouting.length ? "scouting_only" : "no_candidates",
    exactActiveCount: sorted.length,
    strictExactCount: sorted.filter((candidate) => candidate.matchLevel === "exact").length,
    strongMatchCount: sorted.filter((candidate) => candidate.matchLevel === "strong").length,
    scoutingCount: scouting.length,
    landedKnownCount: known.length,
    shippingUnknownCount: sorted.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowestLanded,
    ourLanded,
    position,
    gapToLowest: gap,
    suggestions,
    competitors: sorted.slice(0, 8),
    scoutingCandidates: scouting.slice(0, 8),
  };
}

export async function handleActiveMarketAttackWithPackagingGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttack(request, context);
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

  const attack = record(tracking.activeMarketAttack || payload.attack);
  if (!Object.keys(attack).length) {
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

  let title = String(item.title || "");
  if (!title && item.legacy_product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("title")
      .eq("id", item.legacy_product_id)
      .eq("store_id", storeId)
      .maybeSingle();
    title = String(product?.title || "");
  }

  const targetState = collectiblePackagingState(title);
  if (targetState === "unknown") {
    return Response.json(payload, { status: baseResponse.status });
  }

  const nextAttack = correctedAttack({ attack, targetState });
  const existingReasons = array(tracking.reviewReasons)
    .map(String)
    .filter((reason) => !reason.startsWith("active_market_packaging_"));
  const nextReasons = Array.from(
    new Set([
      ...existingReasons,
      "active_market_packaging_guard_applied",
      ...(Number(nextAttack.packagingRejectedCount || 0) > 0
        ? ["active_market_packaging_conflicts_removed"]
        : []),
      ...(Number(nextAttack.packagingUnknownCount || 0) > 0
        ? ["active_market_packaging_unknown_scouting_only"]
        : []),
    ]),
  );
  const nextTracking = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: nextAttack.exactActiveCount,
    pricingEvidenceMode:
      nextAttack.exactActiveCount > 0
        ? "active_market_attack"
        : nextAttack.scoutingCount > 0
          ? "active_market_scouting"
          : "active_market_no_results",
    reviewReasons: nextReasons,
    topMarketComps: nextAttack.competitors,
    updatedAt: new Date().toISOString(),
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
          schema: "truely.instacompInventoryTrackingHistory.v6",
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
      nextAttack.exactActiveCount > 0
        ? "active_market_attack"
        : nextAttack.scoutingCount > 0
          ? "active_market_scouting"
          : "no_exact_active_market",
    diagnostics: {
      ...record(payload.diagnostics),
      packagingState: targetState,
      packagingExactCount: nextAttack.packagingExactCount,
      packagingUnknownCount: nextAttack.packagingUnknownCount,
      packagingRejectedCount: nextAttack.packagingRejectedCount,
    },
  });
}
