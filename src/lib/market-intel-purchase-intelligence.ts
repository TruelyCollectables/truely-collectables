import "server-only";

import {
  getMarketIntelPurchaseLedger,
  type MarketIntelPurchaseLot,
} from "./market-intel";
import { createSupabaseServerClient } from "./supabase-server";

export type PortfolioBucket = "resale" | "hold" | "pc";

export type PurchaseMarketSnapshot = {
  id: string;
  collectible_identity_id: string;
  calculated_at: string;
  sample_size: number;
  median_value: number | null;
  average_value: number | null;
  low_value: number | null;
  high_value: number | null;
  conservative_value: number | null;
  confidence_score: number;
  liquidity_score: number;
  seven_day_change_pct: number | null;
  thirty_day_change_pct: number | null;
  ninety_day_change_pct: number | null;
};

export type PurchaseDateSoldComp = {
  id: string;
  sold_at: string;
  original_title: string | null;
  source_url: string | null;
  unit_delivered_price: number;
  sold_price: number;
  shipping_price: number;
  buyer_fee: number;
  quantity: number;
  match_confidence: number;
  marketplace: { id: string; name: string; slug: string } | null;
};

export type PurchaseResearchSignal = {
  key:
    | "pc_track"
    | "needs_comps"
    | "low_confidence"
    | "sell_window"
    | "take_profit_watch"
    | "momentum_up"
    | "buy_watch"
    | "cooling"
    | "hold_watch";
  label: string;
  tone: "emerald" | "amber" | "rose" | "cyan" | "fuchsia" | "neutral";
  explanation: string;
};

type RawMarketValue = Record<string, unknown>;
type RawSoldComp = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function purchasePortfolioBucket(
  metadata: Record<string, unknown> | null | undefined,
): PortfolioBucket {
  const value = String(metadata?.portfolio_bucket || "resale").toLowerCase();
  if (value === "hold") return "hold";
  if (value === "pc" || value === "personal_collection") return "pc";
  return "resale";
}

export function portfolioBucketLabel(bucket: PortfolioBucket) {
  if (bucket === "hold") return "HOLD / INVESTMENT";
  if (bucket === "pc") return "PERSONAL COLLECTION";
  return "RESALE";
}

export function purchaseSourceLabel(lot: MarketIntelPurchaseLot) {
  const metadata = recordValue(lot.metadata);
  const sourceName = String(metadata.acquisition_source_name || "").trim();
  const sourceType = String(metadata.acquisition_channel || "").trim();
  if (sourceName) return sourceName;
  if (sourceType) return sourceType.replaceAll("_", " ").toUpperCase();
  return lot.marketplace?.name || "Unknown source";
}

function normalizeSnapshot(row: RawMarketValue): PurchaseMarketSnapshot {
  return {
    id: String(row.id),
    collectible_identity_id: String(row.collectible_identity_id),
    calculated_at: String(row.calculated_at),
    sample_size: numberValue(row.sample_size),
    median_value: nullableNumber(row.median_value),
    average_value: nullableNumber(row.average_value),
    low_value: nullableNumber(row.low_value),
    high_value: nullableNumber(row.high_value),
    conservative_value: nullableNumber(row.conservative_value),
    confidence_score: numberValue(row.confidence_score),
    liquidity_score: numberValue(row.liquidity_score),
    seven_day_change_pct: nullableNumber(row.seven_day_change_pct),
    thirty_day_change_pct: nullableNumber(row.thirty_day_change_pct),
    ninety_day_change_pct: nullableNumber(row.ninety_day_change_pct),
  };
}

function nearestPurchaseSnapshot(
  snapshots: PurchaseMarketSnapshot[],
  purchasedAt: string,
) {
  if (snapshots.length === 0) {
    return { snapshot: null, source: "missing" as const };
  }

  const purchaseTime = new Date(purchasedAt).getTime();
  const before = snapshots
    .filter((snapshot) => new Date(snapshot.calculated_at).getTime() <= purchaseTime)
    .sort(
      (left, right) =>
        new Date(right.calculated_at).getTime() -
        new Date(left.calculated_at).getTime(),
    )[0];

  if (before) return { snapshot: before, source: "at_or_before" as const };

  const after = [...snapshots].sort(
    (left, right) =>
      Math.abs(new Date(left.calculated_at).getTime() - purchaseTime) -
      Math.abs(new Date(right.calculated_at).getTime() - purchaseTime),
  )[0];

  return { snapshot: after || null, source: "nearest_after" as const };
}

function percentChange(current: number | null, baseline: number | null) {
  if (current === null || baseline === null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function buildResearchSignal(input: {
  bucket: PortfolioBucket;
  currentMarket: number | null;
  unitCost: number;
  weeklyChange: number | null;
  confidence: number;
  sampleSize: number;
}): PurchaseResearchSignal {
  const { bucket, currentMarket, unitCost, weeklyChange, confidence, sampleSize } = input;

  if (bucket === "pc") {
    return {
      key: "pc_track",
      label: "PC TRACK",
      tone: "fuchsia",
      explanation:
        "Personal Collection position. TCOS tracks value and movement but does not create an automatic sell signal.",
    };
  }

  if (currentMarket === null || sampleSize === 0) {
    return {
      key: "needs_comps",
      label: "NEEDS COMPS",
      tone: "neutral",
      explanation:
        "No defensible exact-card market value exists yet. Add or import verified sold comps before acting.",
    };
  }

  if (confidence < 50 || sampleSize < 2) {
    return {
      key: "low_confidence",
      label: "LOW CONFIDENCE",
      tone: "amber",
      explanation:
        "The market sample is too thin for a strong buy or sell signal. Treat the current value as research only.",
    };
  }

  const costMove = unitCost > 0 ? ((currentMarket - unitCost) / unitCost) * 100 : null;

  if (bucket === "resale" && costMove !== null && costMove >= 25 && (weeklyChange ?? 0) >= 0) {
    return {
      key: "sell_window",
      label: "SELL WINDOW",
      tone: "emerald",
      explanation:
        "Current exact-card value is at least 25% above unit cost and weekly momentum is not negative. Review fees and list-price targets.",
    };
  }

  if (bucket === "resale" && costMove !== null && costMove >= 20 && (weeklyChange ?? 0) < 0) {
    return {
      key: "take_profit_watch",
      label: "TAKE-PROFIT WATCH",
      tone: "amber",
      explanation:
        "The position remains above cost, but the weekly market is cooling. Review an exit before more momentum is lost.",
    };
  }

  if ((weeklyChange ?? 0) >= 10) {
    return {
      key: "momentum_up",
      label: "MOMENTUM UP",
      tone: "cyan",
      explanation:
        "Verified exact-card value moved up at least 10% over seven days. Watch for stronger sale prices or avoid chasing a spike.",
    };
  }

  if (costMove !== null && costMove <= -15 && (weeklyChange ?? 0) > 0) {
    return {
      key: "buy_watch",
      label: "BUY WATCH",
      tone: "cyan",
      explanation:
        "Current value is below unit cost while weekly movement has turned positive. Review whether the card still fits the strategy before adding.",
    };
  }

  if ((weeklyChange ?? 0) <= -10) {
    return {
      key: "cooling",
      label: "COOLING",
      tone: "rose",
      explanation:
        "Verified exact-card value fell at least 10% over seven days. Avoid automatic averaging down and verify the newest sales.",
    };
  }

  return {
    key: "hold_watch",
    label: "HOLD / WATCH",
    tone: "neutral",
    explanation:
      "No strong weekly or cost-basis trigger is present. Continue tracking verified sales and liquidity.",
  };
}

export async function getPurchaseLedgerIntelligence() {
  const ledger = await getMarketIntelPurchaseLedger();
  const identityIds = Array.from(
    new Set(
      ledger
        .map((row) => row.lot.collectible_identity_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const supabase = createSupabaseServerClient({ admin: true });

  const { data, error } = identityIds.length
    ? await supabase
        .from("tcos_mi_market_values")
        .select(
          "id,collectible_identity_id,calculated_at,sample_size,median_value,average_value,low_value,high_value,conservative_value,confidence_score,liquidity_score,seven_day_change_pct,thirty_day_change_pct,ninety_day_change_pct",
        )
        .in("collectible_identity_id", identityIds)
        .order("calculated_at", { ascending: false })
    : { data: [], error: null };

  if (error) throw new Error(error.message);

  const snapshotsByIdentity = new Map<string, PurchaseMarketSnapshot[]>();
  for (const raw of data || []) {
    const snapshot = normalizeSnapshot(raw as RawMarketValue);
    const rows = snapshotsByIdentity.get(snapshot.collectible_identity_id) || [];
    rows.push(snapshot);
    snapshotsByIdentity.set(snapshot.collectible_identity_id, rows);
  }

  return ledger.map((row) => {
    const identityId = row.lot.collectible_identity_id;
    const snapshots = identityId ? snapshotsByIdentity.get(identityId) || [] : [];
    const current = snapshots[0] || null;
    const baselineResult = nearestPurchaseSnapshot(snapshots, row.lot.purchased_at);
    const baseline = baselineResult.snapshot;
    const currentMarket = current?.conservative_value ?? null;
    const purchaseMarket = baseline?.conservative_value ?? null;
    const weeklyChange = current?.seven_day_change_pct ?? null;
    const bucket = purchasePortfolioBucket(row.lot.metadata);
    const signal = buildResearchSignal({
      bucket,
      currentMarket,
      unitCost: numberValue(row.lot.unit_cost_basis),
      weeklyChange,
      confidence: current?.confidence_score || 0,
      sampleSize: current?.sample_size || 0,
    });

    return {
      ...row,
      bucket,
      source_label: purchaseSourceLabel(row.lot),
      current_market: current,
      purchase_market: baseline,
      purchase_market_source: baselineResult.source,
      since_purchase_change_pct: percentChange(currentMarket, purchaseMarket),
      weekly_change_pct: weeklyChange,
      signal,
    };
  });
}

export async function getPurchaseDetailIntelligence(lot: MarketIntelPurchaseLot) {
  if (!lot.collectible_identity_id) {
    return {
      current: null,
      purchaseBaseline: null,
      purchaseBaselineSource: "missing" as const,
      purchaseComps: [] as PurchaseDateSoldComp[],
      recentComps: [] as PurchaseDateSoldComp[],
      weeklyChangePct: null,
      sincePurchaseChangePct: null,
      signal: buildResearchSignal({
        bucket: purchasePortfolioBucket(lot.metadata),
        currentMarket: null,
        unitCost: numberValue(lot.unit_cost_basis),
        weeklyChange: null,
        confidence: 0,
        sampleSize: 0,
      }),
    };
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const [valueResult, compResult, marketplaceResult] = await Promise.all([
    supabase
      .from("tcos_mi_market_values")
      .select(
        "id,collectible_identity_id,calculated_at,sample_size,median_value,average_value,low_value,high_value,conservative_value,confidence_score,liquidity_score,seven_day_change_pct,thirty_day_change_pct,ninety_day_change_pct",
      )
      .eq("collectible_identity_id", lot.collectible_identity_id)
      .order("calculated_at", { ascending: false })
      .limit(100),
    supabase
      .from("tcos_mi_sold_comps")
      .select(
        "id,marketplace_id,sold_at,original_title,source_url,unit_delivered_price,sold_price,shipping_price,buyer_fee,quantity,match_confidence,verified,excluded,outlier_flag",
      )
      .eq("collectible_identity_id", lot.collectible_identity_id)
      .eq("verified", true)
      .eq("excluded", false)
      .eq("outlier_flag", false)
      .order("sold_at", { ascending: false })
      .limit(250),
    supabase.from("tcos_mi_marketplaces").select("id,name,slug"),
  ]);

  for (const result of [valueResult, compResult, marketplaceResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const snapshots = (valueResult.data || []).map((row) =>
    normalizeSnapshot(row as RawMarketValue),
  );
  const current = snapshots[0] || null;
  const baselineResult = nearestPurchaseSnapshot(snapshots, lot.purchased_at);
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [String(row.id), row]),
  );
  const comps = (compResult.data || []).map((row): PurchaseDateSoldComp => {
    const raw = row as RawSoldComp;
    return {
      id: String(raw.id),
      sold_at: String(raw.sold_at),
      original_title: raw.original_title ? String(raw.original_title) : null,
      source_url: raw.source_url ? String(raw.source_url) : null,
      unit_delivered_price: numberValue(raw.unit_delivered_price),
      sold_price: numberValue(raw.sold_price),
      shipping_price: numberValue(raw.shipping_price),
      buyer_fee: numberValue(raw.buyer_fee),
      quantity: Math.max(1, numberValue(raw.quantity, 1)),
      match_confidence: numberValue(raw.match_confidence),
      marketplace: marketplaceById.get(String(raw.marketplace_id)) || null,
    };
  });

  const purchaseTime = new Date(lot.purchased_at).getTime();
  const purchaseStart = purchaseTime - 90 * 86_400_000;
  const purchaseEnd = purchaseTime + 7 * 86_400_000;
  const purchaseComps = comps
    .filter((comp) => {
      const soldAt = new Date(comp.sold_at).getTime();
      return soldAt >= purchaseStart && soldAt <= purchaseEnd;
    })
    .sort(
      (left, right) =>
        Math.abs(new Date(left.sold_at).getTime() - purchaseTime) -
        Math.abs(new Date(right.sold_at).getTime() - purchaseTime),
    )
    .slice(0, 12);

  const currentMarket = current?.conservative_value ?? null;
  const purchaseMarket = baselineResult.snapshot?.conservative_value ?? null;
  const bucket = purchasePortfolioBucket(lot.metadata);

  return {
    current,
    purchaseBaseline: baselineResult.snapshot,
    purchaseBaselineSource: baselineResult.source,
    purchaseComps,
    recentComps: comps.slice(0, 12),
    weeklyChangePct: current?.seven_day_change_pct ?? null,
    sincePurchaseChangePct: percentChange(currentMarket, purchaseMarket),
    signal: buildResearchSignal({
      bucket,
      currentMarket,
      unitCost: numberValue(lot.unit_cost_basis),
      weeklyChange: current?.seven_day_change_pct ?? null,
      confidence: current?.confidence_score || 0,
      sampleSize: current?.sample_size || 0,
    }),
  };
}

export async function updatePurchasePortfolioBucket(
  purchaseLotId: string,
  bucket: PortfolioBucket,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("metadata")
    .eq("id", purchaseLotId)
    .single();
  if (error) throw new Error(error.message);

  const metadata = recordValue(data.metadata);
  const { error: updateError } = await supabase
    .from("tcos_mi_purchase_lots")
    .update({
      metadata: {
        ...metadata,
        portfolio_bucket: bucket,
        strategy_updated_at: new Date().toISOString(),
      },
    })
    .eq("id", purchaseLotId);
  if (updateError) throw new Error(updateError.message);
}
