import "server-only";

import {
  getMarketIntelDealWorkbench,
  type MarketIntelDealListing,
} from "./market-intel-deals";
import { getMarketIntelPurchaseLedger } from "./market-intel";
import { createSupabaseServerClient } from "./supabase-server";

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
) {
  const parsed = Number(metadata?.[key] ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type MarketIntelPurchaseCandidate = MarketIntelDealListing & {
  expected_units_sold: number;
  expected_net_per_sold_unit: number | null;
  break_even_units: number | null;
  margin_of_safety_units: number | null;
  expected_roi_pct: number | null;
  existing_purchase_lot_id: string | null;
  existing_purchase_number: number | null;
};

export async function getMarketIntelPurchaseDesk() {
  const { listings } = await getMarketIntelDealWorkbench();
  const actionable = listings.filter(
    (listing) => listing.listing_status === "active" && listing.score?.actionable,
  );
  const listingIds = actionable.map((listing) => listing.id);
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: purchases, error } = listingIds.length
    ? await supabase
        .from("tcos_mi_purchase_lots")
        .select("id,purchase_number,source_listing_id")
        .in("source_listing_id", listingIds)
    : { data: [], error: null };

  if (error) throw new Error(error.message);

  const purchaseByListing = new Map(
    (purchases || []).map((purchase) => [
      String(purchase.source_listing_id),
      {
        id: String(purchase.id),
        purchaseNumber: numberValue(purchase.purchase_number),
      },
    ]),
  );

  const candidates = actionable
    .map((listing): MarketIntelPurchaseCandidate => {
      const score = listing.score!;
      const metadata = listing.metadata || {};
      const marketUnit = numberValue(
        listing.identity?.latest_value?.conservative_value,
      );
      const quantity = Math.max(1, numberValue(listing.quantity));
      const sellThroughPct = Math.max(
        0,
        Math.min(100, metadataNumber(metadata, "sell_through_pct", 100)),
      );
      const expectedUnitsSold = Math.max(
        1,
        Math.ceil(quantity * (sellThroughPct / 100)),
      );
      const resaleFeePct = Math.max(
        0,
        Math.min(100, metadataNumber(metadata, "resale_fee_pct", 13.5)),
      );
      const outboundShipping = Math.max(
        0,
        metadataNumber(metadata, "expected_outbound_shipping", 0),
      );
      const supplies = Math.max(
        0,
        metadataNumber(metadata, "expected_supplies", 0),
      );
      const netPerSoldUnit =
        marketUnit > 0
          ? marketUnit * (1 - resaleFeePct / 100) -
            outboundShipping / expectedUnitsSold -
            supplies / expectedUnitsSold
          : null;
      const breakEvenUnits =
        netPerSoldUnit && netPerSoldUnit > 0
          ? Math.ceil(numberValue(score.delivered_cost) / netPerSoldUnit)
          : null;
      const marginOfSafetyUnits =
        breakEvenUnits === null ? null : quantity - breakEvenUnits;
      const expectedRoiPct =
        score.expected_net_profit !== null && score.delivered_cost > 0
          ? (score.expected_net_profit / score.delivered_cost) * 100
          : null;
      const existing = purchaseByListing.get(listing.id);

      return {
        ...listing,
        expected_units_sold: expectedUnitsSold,
        expected_net_per_sold_unit: netPerSoldUnit,
        break_even_units: breakEvenUnits,
        margin_of_safety_units: marginOfSafetyUnits,
        expected_roi_pct: expectedRoiPct,
        existing_purchase_lot_id: existing?.id || null,
        existing_purchase_number: existing?.purchaseNumber || null,
      };
    })
    .sort(
      (left, right) =>
        numberValue(right.score?.buy_score) -
        numberValue(left.score?.buy_score),
    );

  return {
    candidates,
    totals: {
      actionable: candidates.length,
      wholesale: candidates.filter((candidate) => candidate.quantity > 1).length,
      capitalRequired: candidates.reduce(
        (sum, candidate) => sum + numberValue(candidate.score?.delivered_cost),
        0,
      ),
      expectedNetProfit: candidates.reduce(
        (sum, candidate) => sum + numberValue(candidate.score?.expected_net_profit),
        0,
      ),
    },
  };
}

export type MarketIntelPortfolioPosition = Awaited<
  ReturnType<typeof getMarketIntelPurchaseLedger>
>[number] & {
  current_market_unit: number | null;
  market_confidence: number;
  market_sample_size: number;
  remaining_cost_basis: number;
  estimated_remaining_market_value: number | null;
  unrealized_gross_spread: number | null;
  combined_gross_return: number;
  combined_roi_pct: number | null;
};

export async function getMarketIntelPortfolio() {
  const ledger = await getMarketIntelPurchaseLedger();
  const identityIds = Array.from(
    new Set(
      ledger
        .map((row) => row.lot.collectible_identity_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: values, error } = identityIds.length
    ? await supabase
        .from("tcos_mi_market_values")
        .select(
          "collectible_identity_id,conservative_value,confidence_score,sample_size,calculated_at",
        )
        .in("collectible_identity_id", identityIds)
        .order("calculated_at", { ascending: false })
    : { data: [], error: null };

  if (error) throw new Error(error.message);

  const latestValueByIdentity = new Map<
    string,
    {
      marketUnit: number | null;
      confidence: number;
      sampleSize: number;
    }
  >();

  for (const value of values || []) {
    const identityId = String(value.collectible_identity_id);
    if (!latestValueByIdentity.has(identityId)) {
      const rawMarket = value.conservative_value;
      latestValueByIdentity.set(identityId, {
        marketUnit:
          rawMarket === null || rawMarket === undefined
            ? null
            : numberValue(rawMarket),
        confidence: numberValue(value.confidence_score),
        sampleSize: numberValue(value.sample_size),
      });
    }
  }

  const positions = ledger.map((row): MarketIntelPortfolioPosition => {
    const performance = row.performance;
    const quantityRemaining = numberValue(
      performance?.quantity_remaining ?? row.lot.quantity_purchased,
    );
    const unitCost = numberValue(row.lot.unit_cost_basis);
    const remainingCostBasis = quantityRemaining * unitCost;
    const market = row.lot.collectible_identity_id
      ? latestValueByIdentity.get(row.lot.collectible_identity_id)
      : undefined;
    const currentMarketUnit = market?.marketUnit ?? null;
    const estimatedRemainingMarketValue =
      currentMarketUnit === null
        ? null
        : currentMarketUnit * quantityRemaining;
    const unrealizedGrossSpread =
      estimatedRemainingMarketValue === null
        ? null
        : estimatedRemainingMarketValue - remainingCostBasis;
    const realizedGrossProfit = numberValue(performance?.realized_gross_profit);
    const combinedGrossReturn =
      realizedGrossProfit + numberValue(unrealizedGrossSpread);
    const totalCost = numberValue(row.lot.total_acquisition_cost);

    return {
      ...row,
      current_market_unit: currentMarketUnit,
      market_confidence: market?.confidence || 0,
      market_sample_size: market?.sampleSize || 0,
      remaining_cost_basis: remainingCostBasis,
      estimated_remaining_market_value: estimatedRemainingMarketValue,
      unrealized_gross_spread: unrealizedGrossSpread,
      combined_gross_return: combinedGrossReturn,
      combined_roi_pct:
        totalCost > 0 ? (combinedGrossReturn / totalCost) * 100 : null,
    };
  });

  const totals = positions.reduce(
    (sum, position) => {
      sum.invested += numberValue(position.lot.total_acquisition_cost);
      sum.realizedNetProceeds += numberValue(
        position.performance?.realized_net_proceeds,
      );
      sum.realizedGrossProfit += numberValue(
        position.performance?.realized_gross_profit,
      );
      sum.remainingCostBasis += position.remaining_cost_basis;
      sum.estimatedRemainingMarketValue += numberValue(
        position.estimated_remaining_market_value,
      );
      sum.unrealizedGrossSpread += numberValue(
        position.unrealized_gross_spread,
      );
      sum.combinedGrossReturn += position.combined_gross_return;
      sum.unitsRemaining += numberValue(
        position.performance?.quantity_remaining ??
          position.lot.quantity_purchased,
      );
      return sum;
    },
    {
      invested: 0,
      realizedNetProceeds: 0,
      realizedGrossProfit: 0,
      remainingCostBasis: 0,
      estimatedRemainingMarketValue: 0,
      unrealizedGrossSpread: 0,
      combinedGrossReturn: 0,
      unitsRemaining: 0,
    },
  );

  return {
    positions,
    totals: {
      ...totals,
      combinedRoiPct:
        totals.invested > 0
          ? (totals.combinedGrossReturn / totals.invested) * 100
          : null,
    },
  };
}
