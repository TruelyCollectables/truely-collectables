import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelGrowthIdentity = {
  id: string;
  subject_id: string | null;
  display_name: string;
  parallel_name: string;
  insert_name: string | null;
  variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookie_designation: boolean;
  condition_type: string;
  subject_name: string | null;
  non_base_reasons: string[];
  eligible_for_growth: boolean;
  latest_value: {
    conservative_value: number | null;
    sample_size: number;
    confidence_score: number;
    liquidity_score: number;
    calculated_at: string;
  } | null;
};

export type MarketIntelGrowthListing = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string | null;
  direct_url: string;
  original_title: string;
  delivered_price: number;
  quantity: number;
  seller_name: string | null;
  listing_status: string;
  first_seen_at: string;
  marketplace_name: string | null;
  identity: MarketIntelGrowthIdentity | null;
};

export type MarketIntelGrowthProjection = {
  unit_delivered_cost: number;
  expected_units_sold: number;
  target_gross_revenue: number;
  net_per_sold_unit: number;
  projected_net_proceeds: number;
  projected_net_profit: number;
  projected_roi_pct: number | null;
  upside_multiple: number | null;
  break_even_units: number | null;
  margin_of_safety_units: number | null;
  target_vs_current_market_pct: number | null;
  growth_score: number;
  risk_score: number;
  classification: string;
  classification_label: string;
  explanation: string;
};

export type MarketIntelGrowthSpec = {
  id: string;
  collectible_identity_id: string;
  source_listing_id: string | null;
  status: string;
  quantity: number;
  total_delivered_cost: number;
  target_exit_price: number;
  sell_through_pct: number;
  resale_fee_pct: number;
  outbound_shipping_per_card: number;
  supplies_per_card: number;
  hold_months: number;
  conviction_score: number;
  catalyst: string | null;
  thesis: string | null;
  thesis_expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  identity: MarketIntelGrowthIdentity;
  source_listing: MarketIntelGrowthListing | null;
  projection: MarketIntelGrowthProjection;
};

type GrowthProjectionInput = {
  identityEligible: boolean;
  quantity: number;
  totalDeliveredCost: number;
  targetExitPrice: number;
  sellThroughPct: number;
  resaleFeePct: number;
  outboundShippingPerCard: number;
  suppliesPerCard: number;
  holdMonths: number;
  convictionScore: number;
  currentMarketUnit: number | null;
  marketSampleSize: number;
  marketConfidence: number;
  marketLiquidity: number;
  thesisExpiresAt?: string | null;
};

const BASE_PARALLEL_NAMES = new Set([
  "",
  "base",
  "base card",
  "regular",
  "standard",
  "none",
  "true base",
]);

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function growthIdentityEligibility(identity: {
  parallel_name?: string | null;
  insert_name?: string | null;
  variation_name?: string | null;
  serial_numbered_to?: number | null;
  autograph?: boolean | null;
  memorabilia?: boolean | null;
}) {
  const reasons: string[] = [];
  const parallel = normalize(identity.parallel_name);

  if (!BASE_PARALLEL_NAMES.has(parallel)) {
    reasons.push(identity.parallel_name?.trim() || "Named parallel");
  }
  if (identity.insert_name?.trim()) reasons.push("Insert");
  if (identity.variation_name?.trim()) reasons.push("Variation");
  if (numberValue(identity.serial_numbered_to) > 0) {
    reasons.push(`Numbered /${numberValue(identity.serial_numbered_to)}`);
  }
  if (identity.autograph) reasons.push("Autograph");
  if (identity.memorabilia) reasons.push("Memorabilia");

  return {
    eligible: reasons.length > 0,
    reasons,
  };
}

export function calculateGrowthSpecProjection(
  input: GrowthProjectionInput,
): MarketIntelGrowthProjection {
  const quantity = Math.max(1, Math.round(numberValue(input.quantity, 1)));
  const totalDeliveredCost = Math.max(0, numberValue(input.totalDeliveredCost));
  const targetExitPrice = Math.max(0, numberValue(input.targetExitPrice));
  const sellThroughPct = clamp(numberValue(input.sellThroughPct, 80));
  const resaleFeePct = clamp(numberValue(input.resaleFeePct, 13.5));
  const outboundShippingPerCard = Math.max(
    0,
    numberValue(input.outboundShippingPerCard, 1.25),
  );
  const suppliesPerCard = Math.max(0, numberValue(input.suppliesPerCard, 0.15));
  const holdMonths = Math.max(1, Math.round(numberValue(input.holdMonths, 24)));
  const convictionScore = clamp(numberValue(input.convictionScore, 50));
  const unitDeliveredCost = totalDeliveredCost / quantity;
  const expectedUnitsSold =
    sellThroughPct <= 0
      ? 0
      : Math.max(1, Math.floor(quantity * (sellThroughPct / 100)));
  const targetGrossRevenue = targetExitPrice * expectedUnitsSold;
  const netPerSoldUnit =
    targetExitPrice * (1 - resaleFeePct / 100) -
    outboundShippingPerCard -
    suppliesPerCard;
  const projectedNetProceeds = Math.max(0, netPerSoldUnit * expectedUnitsSold);
  const projectedNetProfit = projectedNetProceeds - totalDeliveredCost;
  const projectedRoiPct =
    totalDeliveredCost > 0 ? (projectedNetProfit / totalDeliveredCost) * 100 : null;
  const upsideMultiple =
    unitDeliveredCost > 0 ? targetExitPrice / unitDeliveredCost : null;
  const breakEvenUnits =
    netPerSoldUnit > 0 ? Math.ceil(totalDeliveredCost / netPerSoldUnit) : null;
  const marginOfSafetyUnits =
    breakEvenUnits === null ? null : expectedUnitsSold - breakEvenUnits;
  const targetVsCurrentMarketPct =
    input.currentMarketUnit && input.currentMarketUnit > 0
      ? ((targetExitPrice - input.currentMarketUnit) / input.currentMarketUnit) * 100
      : null;

  let growthScore = 0;
  growthScore += unitDeliveredCost <= 2 ? 25 : unitDeliveredCost <= 5 ? 20 : 0;
  growthScore +=
    (upsideMultiple || 0) >= 5
      ? 25
      : (upsideMultiple || 0) >= 4
        ? 20
        : (upsideMultiple || 0) >= 3
          ? 12
          : (upsideMultiple || 0) >= 2
            ? 5
            : 0;
  growthScore +=
    (projectedRoiPct || 0) >= 400
      ? 20
      : (projectedRoiPct || 0) >= 250
        ? 15
        : (projectedRoiPct || 0) >= 150
          ? 10
          : projectedNetProfit > 0
            ? 5
            : 0;
  growthScore += convictionScore * 0.15;
  growthScore += clamp(input.marketConfidence) * 0.05;
  growthScore += clamp(input.marketLiquidity) * 0.05;
  if (
    marginOfSafetyUnits !== null &&
    expectedUnitsSold > 0 &&
    marginOfSafetyUnits >= Math.ceil(expectedUnitsSold * 0.5)
  ) {
    growthScore += 5;
  } else if ((marginOfSafetyUnits || 0) >= 1) {
    growthScore += 2;
  }
  growthScore = clamp(growthScore);

  let riskScore = 0;
  if (input.currentMarketUnit === null || input.currentMarketUnit <= 0) riskScore += 20;
  if (input.marketSampleSize < 2) riskScore += 15;
  if (input.marketConfidence < 35) riskScore += 10;
  if (input.marketLiquidity < 20) riskScore += 10;
  if (
    input.currentMarketUnit &&
    input.currentMarketUnit > 0 &&
    targetExitPrice / input.currentMarketUnit >= 8
  ) {
    riskScore += 15;
  }
  if (holdMonths > 24) riskScore += 10;
  if (convictionScore < 50) riskScore += 10;
  if (totalDeliveredCost > 50) riskScore += 10;
  if (breakEvenUnits !== null && breakEvenUnits > expectedUnitsSold) riskScore += 20;
  if (
    input.thesisExpiresAt &&
    new Date(input.thesisExpiresAt).getTime() < Date.now()
  ) {
    riskScore += 20;
  }
  riskScore = clamp(riskScore);

  let classification = "pass";
  let classificationLabel = "PASS";

  if (!input.identityEligible) {
    classification = "base_rejected";
    classificationLabel = "BASE REJECTED";
  } else if (unitDeliveredCost > 5) {
    classification = "over_cost_ceiling";
    classificationLabel = "OVER $5 PER CARD";
  } else if (
    projectedNetProfit >= 100 &&
    (projectedRoiPct || 0) >= 300 &&
    (upsideMultiple || 0) >= 4 &&
    growthScore >= 70 &&
    riskScore <= 55
  ) {
    classification = "big_money_maker";
    classificationLabel = "PROJECTED BIG MONEY MAKER";
  } else if (
    projectedNetProfit >= 50 &&
    (projectedRoiPct || 0) >= 200 &&
    (upsideMultiple || 0) >= 4 &&
    growthScore >= 60
  ) {
    classification = "strong_growth_spec";
    classificationLabel = "STRONG GROWTH SPEC";
  } else if (
    projectedNetProfit > 0 &&
    (upsideMultiple || 0) >= 3 &&
    growthScore >= 45
  ) {
    classification = "growth_spec";
    classificationLabel = "GROWTH SPEC";
  } else if (projectedNetProfit > 0) {
    classification = "speculative_watch";
    classificationLabel = "SPECULATIVE WATCH";
  }

  const explanation = !input.identityEligible
    ? "Rejected because the exact identity has no non-base parallel, insert, variation, numbering, autograph, or memorabilia signal."
    : unitDeliveredCost > 5
      ? `Cost is $${unitDeliveredCost.toFixed(2)} per card, above the $5 delivered ceiling.`
      : `${quantity} card${quantity === 1 ? "" : "s"} at $${unitDeliveredCost.toFixed(2)} each; sell ${expectedUnitsSold} at $${targetExitPrice.toFixed(2)} to project $${projectedNetProfit.toFixed(2)} net profit and ${projectedRoiPct?.toFixed(0) || "0"}% ROI.`;

  return {
    unit_delivered_cost: unitDeliveredCost,
    expected_units_sold: expectedUnitsSold,
    target_gross_revenue: targetGrossRevenue,
    net_per_sold_unit: netPerSoldUnit,
    projected_net_proceeds: projectedNetProceeds,
    projected_net_profit: projectedNetProfit,
    projected_roi_pct: projectedRoiPct,
    upside_multiple: upsideMultiple,
    break_even_units: breakEvenUnits,
    margin_of_safety_units: marginOfSafetyUnits,
    target_vs_current_market_pct: targetVsCurrentMarketPct,
    growth_score: growthScore,
    risk_score: riskScore,
    classification,
    classification_label: classificationLabel,
    explanation,
  };
}

export async function getMarketIntelGrowthWorkbench() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [identityResult, subjectResult, valueResult, listingResult, marketplaceResult, specResult] =
    await Promise.all([
      supabase
        .from("tcos_mi_collectible_identities")
        .select(
          "id,subject_id,display_name,parallel_name,insert_name,variation_name,serial_numbered_to,autograph,memorabilia,rookie_designation,condition_type",
        )
        .eq("active", true)
        .order("display_name"),
      supabase.from("tcos_mi_subjects").select("id,name"),
      supabase
        .from("tcos_mi_market_values")
        .select(
          "collectible_identity_id,conservative_value,sample_size,confidence_score,liquidity_score,calculated_at",
        )
        .order("calculated_at", { ascending: false }),
      supabase
        .from("tcos_mi_listings")
        .select(
          "id,marketplace_id,collectible_identity_id,direct_url,original_title,delivered_price,quantity,seller_name,listing_status,first_seen_at",
        )
        .eq("listing_status", "active")
        .order("first_seen_at", { ascending: false }),
      supabase
        .from("tcos_mi_marketplaces")
        .select("id,name")
        .eq("active", true),
      supabase
        .from("tcos_mi_growth_specs")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

  for (const result of [
    identityResult,
    subjectResult,
    valueResult,
    listingResult,
    marketplaceResult,
    specResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const subjectById = new Map(
    (subjectResult.data || []).map((row) => [String(row.id), String(row.name)]),
  );
  const latestValueByIdentity = new Map<
    string,
    MarketIntelGrowthIdentity["latest_value"]
  >();
  for (const row of valueResult.data || []) {
    const identityId = String(row.collectible_identity_id);
    if (!latestValueByIdentity.has(identityId)) {
      latestValueByIdentity.set(identityId, {
        conservative_value: nullableNumber(row.conservative_value),
        sample_size: numberValue(row.sample_size),
        confidence_score: numberValue(row.confidence_score),
        liquidity_score: numberValue(row.liquidity_score),
        calculated_at: String(row.calculated_at),
      });
    }
  }

  const identities = (identityResult.data || []).map((row) => {
    const eligibility = growthIdentityEligibility(row);
    return {
      id: String(row.id),
      subject_id: row.subject_id ? String(row.subject_id) : null,
      display_name: String(row.display_name),
      parallel_name: String(row.parallel_name || "Base"),
      insert_name: row.insert_name ? String(row.insert_name) : null,
      variation_name: row.variation_name ? String(row.variation_name) : null,
      serial_numbered_to: nullableNumber(row.serial_numbered_to),
      autograph: Boolean(row.autograph),
      memorabilia: Boolean(row.memorabilia),
      rookie_designation: Boolean(row.rookie_designation),
      condition_type: String(row.condition_type),
      subject_name: row.subject_id
        ? subjectById.get(String(row.subject_id)) || null
        : null,
      non_base_reasons: eligibility.reasons,
      eligible_for_growth: eligibility.eligible,
      latest_value: latestValueByIdentity.get(String(row.id)) || null,
    } satisfies MarketIntelGrowthIdentity;
  });
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [String(row.id), String(row.name)]),
  );

  const listings = (listingResult.data || []).map((row) => ({
    id: String(row.id),
    marketplace_id: String(row.marketplace_id),
    collectible_identity_id: row.collectible_identity_id
      ? String(row.collectible_identity_id)
      : null,
    direct_url: String(row.direct_url),
    original_title: String(row.original_title),
    delivered_price: numberValue(row.delivered_price),
    quantity: Math.max(1, numberValue(row.quantity, 1)),
    seller_name: row.seller_name ? String(row.seller_name) : null,
    listing_status: String(row.listing_status),
    first_seen_at: String(row.first_seen_at),
    marketplace_name: marketplaceById.get(String(row.marketplace_id)) || null,
    identity: row.collectible_identity_id
      ? identityById.get(String(row.collectible_identity_id)) || null
      : null,
  })) satisfies MarketIntelGrowthListing[];
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));

  const specs = (specResult.data || [])
    .map((row): MarketIntelGrowthSpec | null => {
      const identity = identityById.get(String(row.collectible_identity_id));
      if (!identity) return null;
      const sourceListing = row.source_listing_id
        ? listingById.get(String(row.source_listing_id)) || null
        : null;
      const projection = calculateGrowthSpecProjection({
        identityEligible: identity.eligible_for_growth,
        quantity: numberValue(row.quantity, 1),
        totalDeliveredCost: numberValue(row.total_delivered_cost),
        targetExitPrice: numberValue(row.target_exit_price, 25),
        sellThroughPct: numberValue(row.sell_through_pct, 80),
        resaleFeePct: numberValue(row.resale_fee_pct, 13.5),
        outboundShippingPerCard: numberValue(row.outbound_shipping_per_card, 1.25),
        suppliesPerCard: numberValue(row.supplies_per_card, 0.15),
        holdMonths: numberValue(row.hold_months, 24),
        convictionScore: numberValue(row.conviction_score, 50),
        currentMarketUnit: identity.latest_value?.conservative_value || null,
        marketSampleSize: identity.latest_value?.sample_size || 0,
        marketConfidence: identity.latest_value?.confidence_score || 0,
        marketLiquidity: identity.latest_value?.liquidity_score || 0,
        thesisExpiresAt: row.thesis_expires_at
          ? String(row.thesis_expires_at)
          : null,
      });

      return {
        id: String(row.id),
        collectible_identity_id: String(row.collectible_identity_id),
        source_listing_id: row.source_listing_id
          ? String(row.source_listing_id)
          : null,
        status: String(row.status),
        quantity: Math.max(1, numberValue(row.quantity, 1)),
        total_delivered_cost: numberValue(row.total_delivered_cost),
        target_exit_price: numberValue(row.target_exit_price, 25),
        sell_through_pct: numberValue(row.sell_through_pct, 80),
        resale_fee_pct: numberValue(row.resale_fee_pct, 13.5),
        outbound_shipping_per_card: numberValue(
          row.outbound_shipping_per_card,
          1.25,
        ),
        supplies_per_card: numberValue(row.supplies_per_card, 0.15),
        hold_months: numberValue(row.hold_months, 24),
        conviction_score: numberValue(row.conviction_score, 50),
        catalyst: row.catalyst ? String(row.catalyst) : null,
        thesis: row.thesis ? String(row.thesis) : null,
        thesis_expires_at: row.thesis_expires_at
          ? String(row.thesis_expires_at)
          : null,
        notes: row.notes ? String(row.notes) : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        identity,
        source_listing: sourceListing,
        projection,
      };
    })
    .filter((value): value is MarketIntelGrowthSpec => Boolean(value));

  const sourceListingIds = new Set(
    specs.map((spec) => spec.source_listing_id).filter(Boolean),
  );
  const autoCandidates = listings
    .filter((listing) => {
      const identity = listing.identity;
      if (!identity?.eligible_for_growth) return false;
      if (sourceListingIds.has(listing.id)) return false;
      return listing.delivered_price / Math.max(1, listing.quantity) <= 5;
    })
    .map((listing) => {
      const identity = listing.identity!;
      const projection = calculateGrowthSpecProjection({
        identityEligible: true,
        quantity: listing.quantity,
        totalDeliveredCost: listing.delivered_price,
        targetExitPrice: 25,
        sellThroughPct: 80,
        resaleFeePct: 13.5,
        outboundShippingPerCard: 1.25,
        suppliesPerCard: 0.15,
        holdMonths: 24,
        convictionScore: 50,
        currentMarketUnit: identity.latest_value?.conservative_value || null,
        marketSampleSize: identity.latest_value?.sample_size || 0,
        marketConfidence: identity.latest_value?.confidence_score || 0,
        marketLiquidity: identity.latest_value?.liquidity_score || 0,
      });
      return { listing, projection };
    })
    .sort(
      (left, right) =>
        right.projection.projected_net_profit -
        left.projection.projected_net_profit,
    );

  const activeSpecs = specs.filter((spec) =>
    ["active", "watch", "bought"].includes(spec.status),
  );

  return {
    identities,
    eligibleIdentities: identities.filter((identity) => identity.eligible_for_growth),
    listings,
    specs,
    autoCandidates,
    totals: {
      active: activeSpecs.length,
      capitalAtRisk: activeSpecs.reduce(
        (sum, spec) => sum + spec.total_delivered_cost,
        0,
      ),
      projectedNetProfit: activeSpecs.reduce(
        (sum, spec) => sum + spec.projection.projected_net_profit,
        0,
      ),
      projectedBigMoneyMakers: activeSpecs.filter(
        (spec) => spec.projection.classification === "big_money_maker",
      ).length,
    },
  };
}
