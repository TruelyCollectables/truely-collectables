import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelMarketplace = {
  id: string;
  name: string;
  slug: string;
};

export type MarketIntelCollectibleIdentity = {
  id: string;
  display_name: string;
  identity_key: string;
};

export type MarketIntelPurchaseLot = {
  id: string;
  purchase_number: number;
  purchased_at: string;
  status: string;
  quantity_purchased: number;
  total_acquisition_cost: number;
  unit_cost_basis: number;
  received_at: string | null;
  source_url: string | null;
  deal_label: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  collectible_identity_id: string | null;
  marketplace_id: string | null;
  collectible: MarketIntelCollectibleIdentity | null;
  marketplace: MarketIntelMarketplace | null;
};

export type MarketIntelPurchasePerformance = {
  purchase_lot_id: string;
  purchase_number: number;
  status: string;
  quantity_purchased: number;
  quantity_sold: number;
  quantity_remaining: number;
  total_acquisition_cost: number;
  unit_cost_basis: number;
  gross_item_sales: number;
  realized_net_proceeds: number;
  realized_gross_profit: number;
  dollars_to_cash_break_even: number;
  cash_break_even_progress_pct: number;
};

export type MarketIntelInventorySale = {
  id: string;
  purchase_lot_id: string;
  marketplace_id: string | null;
  sold_at: string;
  quantity_sold: number;
  gross_item_sales: number;
  shipping_charged: number;
  marketplace_fees: number;
  payment_processing_fees: number;
  actual_postage: number;
  supplies_cost: number;
  refunds_and_adjustments: number;
  net_proceeds: number;
  external_order_id: string | null;
  notes: string | null;
  marketplace: MarketIntelMarketplace | null;
};

type PurchaseLotDatabaseRow = Omit<
  MarketIntelPurchaseLot,
  "collectible" | "marketplace"
>;

type InventorySaleDatabaseRow = Omit<MarketIntelInventorySale, "marketplace">;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function getMarketIntelPurchaseLedger() {
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: lotsData, error: lotsError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select(
      "id,purchase_number,purchased_at,status,quantity_purchased,total_acquisition_cost,unit_cost_basis,received_at,source_url,deal_label,notes,metadata,collectible_identity_id,marketplace_id",
    )
    .order("purchase_number", { ascending: false });

  if (lotsError) {
    throw new Error(`Unable to load Market Intel purchases: ${lotsError.message}`);
  }

  const lots = (lotsData || []) as PurchaseLotDatabaseRow[];
  const identityIds = uniqueIds(lots.map((lot) => lot.collectible_identity_id));
  const marketplaceIds = uniqueIds(lots.map((lot) => lot.marketplace_id));

  const [performanceResult, identitiesResult, marketplacesResult] = await Promise.all([
    supabase
      .from("tcos_mi_purchase_performance")
      .select("*")
      .order("purchase_number", { ascending: false }),
    identityIds.length > 0
      ? supabase
          .from("tcos_mi_collectible_identities")
          .select("id,display_name,identity_key")
          .in("id", identityIds)
      : Promise.resolve({ data: [], error: null }),
    marketplaceIds.length > 0
      ? supabase
          .from("tcos_mi_marketplaces")
          .select("id,name,slug")
          .in("id", marketplaceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (performanceResult.error) {
    throw new Error(
      `Unable to load Market Intel performance: ${performanceResult.error.message}`,
    );
  }
  if (identitiesResult.error) {
    throw new Error(
      `Unable to load collectible identities: ${identitiesResult.error.message}`,
    );
  }
  if (marketplacesResult.error) {
    throw new Error(
      `Unable to load marketplaces: ${marketplacesResult.error.message}`,
    );
  }

  const performanceByLot = new Map(
    ((performanceResult.data || []) as MarketIntelPurchasePerformance[]).map((row) => [
      row.purchase_lot_id,
      {
        ...row,
        quantity_purchased: numberValue(row.quantity_purchased),
        quantity_sold: numberValue(row.quantity_sold),
        quantity_remaining: numberValue(row.quantity_remaining),
        total_acquisition_cost: numberValue(row.total_acquisition_cost),
        unit_cost_basis: numberValue(row.unit_cost_basis),
        gross_item_sales: numberValue(row.gross_item_sales),
        realized_net_proceeds: numberValue(row.realized_net_proceeds),
        realized_gross_profit: numberValue(row.realized_gross_profit),
        dollars_to_cash_break_even: numberValue(row.dollars_to_cash_break_even),
        cash_break_even_progress_pct: numberValue(row.cash_break_even_progress_pct),
      },
    ]),
  );
  const identitiesById = new Map(
    ((identitiesResult.data || []) as MarketIntelCollectibleIdentity[]).map((row) => [
      row.id,
      row,
    ]),
  );
  const marketplacesById = new Map(
    ((marketplacesResult.data || []) as MarketIntelMarketplace[]).map((row) => [
      row.id,
      row,
    ]),
  );

  return lots.map((lot) => ({
    lot: {
      ...lot,
      purchase_number: numberValue(lot.purchase_number),
      quantity_purchased: numberValue(lot.quantity_purchased),
      total_acquisition_cost: numberValue(lot.total_acquisition_cost),
      unit_cost_basis: numberValue(lot.unit_cost_basis),
      metadata: recordValue(lot.metadata),
      collectible: lot.collectible_identity_id
        ? identitiesById.get(lot.collectible_identity_id) || null
        : null,
      marketplace: lot.marketplace_id
        ? marketplacesById.get(lot.marketplace_id) || null
        : null,
    } satisfies MarketIntelPurchaseLot,
    performance: performanceByLot.get(lot.id) || null,
  }));
}

export async function getMarketIntelPurchaseDetail(purchaseLotId: string) {
  const supabase = createSupabaseServerClient({ admin: true });

  const [lotResult, performanceResult, salesResult, marketplacesResult] =
    await Promise.all([
      supabase
        .from("tcos_mi_purchase_lots")
        .select(
          "id,purchase_number,purchased_at,status,quantity_purchased,total_acquisition_cost,unit_cost_basis,received_at,source_url,deal_label,notes,metadata,collectible_identity_id,marketplace_id",
        )
        .eq("id", purchaseLotId)
        .maybeSingle(),
      supabase
        .from("tcos_mi_purchase_performance")
        .select("*")
        .eq("purchase_lot_id", purchaseLotId)
        .maybeSingle(),
      supabase
        .from("tcos_mi_inventory_sales")
        .select(
          "id,purchase_lot_id,marketplace_id,sold_at,quantity_sold,gross_item_sales,shipping_charged,marketplace_fees,payment_processing_fees,actual_postage,supplies_cost,refunds_and_adjustments,net_proceeds,external_order_id,notes",
        )
        .eq("purchase_lot_id", purchaseLotId)
        .order("sold_at", { ascending: false }),
      supabase
        .from("tcos_mi_marketplaces")
        .select("id,name,slug")
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);

  if (lotResult.error) {
    throw new Error(`Unable to load purchase: ${lotResult.error.message}`);
  }
  if (!lotResult.data) return null;
  if (performanceResult.error) {
    throw new Error(
      `Unable to load purchase performance: ${performanceResult.error.message}`,
    );
  }
  if (salesResult.error) {
    throw new Error(`Unable to load recorded sales: ${salesResult.error.message}`);
  }
  if (marketplacesResult.error) {
    throw new Error(`Unable to load marketplaces: ${marketplacesResult.error.message}`);
  }

  const lotRow = lotResult.data as PurchaseLotDatabaseRow;
  const identitiesResult = lotRow.collectible_identity_id
    ? await supabase
        .from("tcos_mi_collectible_identities")
        .select("id,display_name,identity_key")
        .eq("id", lotRow.collectible_identity_id)
        .maybeSingle()
    : { data: null, error: null };

  if (identitiesResult.error) {
    throw new Error(
      `Unable to load collectible identity: ${identitiesResult.error.message}`,
    );
  }

  const marketplaces = (marketplacesResult.data || []) as MarketIntelMarketplace[];
  const marketplaceById = new Map(marketplaces.map((row) => [row.id, row]));
  const sales = ((salesResult.data || []) as InventorySaleDatabaseRow[]).map((sale) => ({
    ...sale,
    quantity_sold: numberValue(sale.quantity_sold),
    gross_item_sales: numberValue(sale.gross_item_sales),
    shipping_charged: numberValue(sale.shipping_charged),
    marketplace_fees: numberValue(sale.marketplace_fees),
    payment_processing_fees: numberValue(sale.payment_processing_fees),
    actual_postage: numberValue(sale.actual_postage),
    supplies_cost: numberValue(sale.supplies_cost),
    refunds_and_adjustments: numberValue(sale.refunds_and_adjustments),
    net_proceeds: numberValue(sale.net_proceeds),
    marketplace: sale.marketplace_id
      ? marketplaceById.get(sale.marketplace_id) || null
      : null,
  }));

  const rawPerformance = performanceResult.data as MarketIntelPurchasePerformance | null;
  const performance = rawPerformance
    ? {
        ...rawPerformance,
        quantity_purchased: numberValue(rawPerformance.quantity_purchased),
        quantity_sold: numberValue(rawPerformance.quantity_sold),
        quantity_remaining: numberValue(rawPerformance.quantity_remaining),
        total_acquisition_cost: numberValue(rawPerformance.total_acquisition_cost),
        unit_cost_basis: numberValue(rawPerformance.unit_cost_basis),
        gross_item_sales: numberValue(rawPerformance.gross_item_sales),
        realized_net_proceeds: numberValue(rawPerformance.realized_net_proceeds),
        realized_gross_profit: numberValue(rawPerformance.realized_gross_profit),
        dollars_to_cash_break_even: numberValue(
          rawPerformance.dollars_to_cash_break_even,
        ),
        cash_break_even_progress_pct: numberValue(
          rawPerformance.cash_break_even_progress_pct,
        ),
      }
    : null;

  const lot: MarketIntelPurchaseLot = {
    ...lotRow,
    purchase_number: numberValue(lotRow.purchase_number),
    quantity_purchased: numberValue(lotRow.quantity_purchased),
    total_acquisition_cost: numberValue(lotRow.total_acquisition_cost),
    unit_cost_basis: numberValue(lotRow.unit_cost_basis),
    metadata: recordValue(lotRow.metadata),
    collectible: (identitiesResult.data as MarketIntelCollectibleIdentity | null) || null,
    marketplace: lotRow.marketplace_id
      ? marketplaceById.get(lotRow.marketplace_id) || null
      : null,
  };

  return {
    lot,
    performance,
    sales,
    marketplaces,
  };
}
