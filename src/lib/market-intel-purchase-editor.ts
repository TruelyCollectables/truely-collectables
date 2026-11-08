import "server-only";

import { createSupabaseServerClient } from "./supabase-server";
import type { PortfolioBucket } from "./market-intel-purchase-intelligence";

export type EditableAcquisitionChannel =
  | "ebay"
  | "marketplace"
  | "card_show"
  | "card_shop"
  | "private_deal"
  | "trade"
  | "other";

export type EditableMarketIntelPurchase = {
  id: string;
  purchase_number: number;
  purchased_at: string;
  status: string;
  quantity_purchased: number;
  item_subtotal: number;
  inbound_shipping: number;
  buyer_fees: number;
  sales_tax: number;
  other_acquisition_cost: number;
  total_acquisition_cost: number;
  unit_cost_basis: number;
  received_at: string | null;
  source_url: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  collectible_identity_id: string | null;
  marketplace_id: string | null;
  source_listing_id: string | null;
  collectible: {
    id: string;
    display_name: string;
    identity_key: string;
  } | null;
  marketplace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  quantity_sold: number;
  sale_count: number;
};

export type PurchaseCorrectionInput = {
  purchaseDate: string;
  portfolioBucket: PortfolioBucket;
  acquisitionChannel: EditableAcquisitionChannel;
  sourceName: string;
  sourceLocation: string;
  externalOrderId: string;
  sourceUrl: string;
  notes: string;
  alreadyReceived: boolean;
  pricingMode: "lot_total" | "per_item";
  quantity: number;
  itemSubtotal: number;
  inboundShipping: number;
  salesTax: number;
  buyerFees: number;
  otherCost: number;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function validMoney(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function normalizedHistory(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").slice(-19)
    : [];
}

export async function getEditableMarketIntelPurchase(
  purchaseLotId: string,
): Promise<EditableMarketIntelPurchase | null> {
  const supabase = createSupabaseServerClient({ admin: true });
  const [lotResult, salesResult] = await Promise.all([
    supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,purchased_at,status,quantity_purchased,item_subtotal,inbound_shipping,buyer_fees,sales_tax,other_acquisition_cost,total_acquisition_cost,unit_cost_basis,received_at,source_url,notes,metadata,collectible_identity_id,marketplace_id,source_listing_id",
      )
      .eq("id", purchaseLotId)
      .maybeSingle(),
    supabase
      .from("tcos_mi_inventory_sales")
      .select("id,quantity_sold")
      .eq("purchase_lot_id", purchaseLotId),
  ]);

  if (lotResult.error) {
    throw new Error(`Unable to load purchase correction data: ${lotResult.error.message}`);
  }
  if (!lotResult.data) return null;
  if (salesResult.error) {
    throw new Error(`Unable to load purchase sales: ${salesResult.error.message}`);
  }

  const lot = lotResult.data as Record<string, unknown>;
  const [identityResult, marketplaceResult] = await Promise.all([
    lot.collectible_identity_id
      ? supabase
          .from("tcos_mi_collectible_identities")
          .select("id,display_name,identity_key")
          .eq("id", String(lot.collectible_identity_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    lot.marketplace_id
      ? supabase
          .from("tcos_mi_marketplaces")
          .select("id,name,slug")
          .eq("id", String(lot.marketplace_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (identityResult.error) throw new Error(identityResult.error.message);
  if (marketplaceResult.error) throw new Error(marketplaceResult.error.message);

  const sales = (salesResult.data || []) as Array<{
    id: string;
    quantity_sold: number | string | null;
  }>;
  const quantitySold = sales.reduce(
    (sum, sale) => sum + numberValue(sale.quantity_sold),
    0,
  );

  return {
    id: String(lot.id),
    purchase_number: numberValue(lot.purchase_number),
    purchased_at: String(lot.purchased_at),
    status: String(lot.status || "awaiting_receipt"),
    quantity_purchased: numberValue(lot.quantity_purchased),
    item_subtotal: numberValue(lot.item_subtotal),
    inbound_shipping: numberValue(lot.inbound_shipping),
    buyer_fees: numberValue(lot.buyer_fees),
    sales_tax: numberValue(lot.sales_tax),
    other_acquisition_cost: numberValue(lot.other_acquisition_cost),
    total_acquisition_cost: numberValue(lot.total_acquisition_cost),
    unit_cost_basis: numberValue(lot.unit_cost_basis),
    received_at: lot.received_at ? String(lot.received_at) : null,
    source_url: lot.source_url ? String(lot.source_url) : null,
    notes: lot.notes ? String(lot.notes) : null,
    metadata: recordValue(lot.metadata),
    collectible_identity_id: lot.collectible_identity_id
      ? String(lot.collectible_identity_id)
      : null,
    marketplace_id: lot.marketplace_id ? String(lot.marketplace_id) : null,
    source_listing_id: lot.source_listing_id ? String(lot.source_listing_id) : null,
    collectible:
      (identityResult.data as EditableMarketIntelPurchase["collectible"]) || null,
    marketplace:
      (marketplaceResult.data as EditableMarketIntelPurchase["marketplace"]) || null,
    quantity_sold: quantitySold,
    sale_count: sales.length,
  };
}

export async function updateMarketIntelPurchase(
  purchaseLotId: string,
  input: PurchaseCorrectionInput,
) {
  const existing = await getEditableMarketIntelPurchase(purchaseLotId);
  if (!existing) throw new Error("Purchase was not found.");

  if (!input.purchaseDate) throw new Error("Purchase date is required.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  if (input.quantity < existing.quantity_sold) {
    throw new Error(
      `Quantity cannot be reduced below ${existing.quantity_sold} because that many units are already recorded as sold.`,
    );
  }

  const costs = [
    input.itemSubtotal,
    input.inboundShipping,
    input.salesTax,
    input.buyerFees,
    input.otherCost,
  ];
  if (!costs.every(validMoney)) {
    throw new Error("Item price, shipping, tax, fees, and other cost must be zero or greater.");
  }
  if (input.sourceUrl && !/^https?:\/\//i.test(input.sourceUrl)) {
    throw new Error("Source URL must begin with http:// or https://.");
  }

  const total = roundMoney(costs.reduce((sum, value) => sum + value, 0));
  const now = new Date().toISOString();
  const oldMetadata = existing.metadata;
  const history = normalizedHistory(oldMetadata.purchase_correction_history);
  const correctionEntry = {
    corrected_at: now,
    previous: {
      purchased_at: existing.purchased_at,
      status: existing.status,
      quantity_purchased: existing.quantity_purchased,
      item_subtotal: existing.item_subtotal,
      inbound_shipping: existing.inbound_shipping,
      sales_tax: existing.sales_tax,
      buyer_fees: existing.buyer_fees,
      other_acquisition_cost: existing.other_acquisition_cost,
      total_acquisition_cost: existing.total_acquisition_cost,
      unit_cost_basis: existing.unit_cost_basis,
      source_url: existing.source_url,
      notes: existing.notes,
      portfolio_bucket: oldMetadata.portfolio_bucket || "resale",
      acquisition_channel: oldMetadata.acquisition_channel || null,
      acquisition_source_name: oldMetadata.acquisition_source_name || null,
      acquisition_location: oldMetadata.acquisition_location || null,
      external_order_id: oldMetadata.external_order_id || null,
    },
  };

  const hasSales = existing.sale_count > 0 || existing.quantity_sold > 0;
  let nextStatus = existing.status;
  let receivedAt = existing.received_at;
  if (!hasSales) {
    nextStatus = input.alreadyReceived ? "in_inventory" : "awaiting_receipt";
    receivedAt = input.alreadyReceived ? existing.received_at || now : null;
  }

  const nextMetadata = {
    ...oldMetadata,
    portfolio_bucket: input.portfolioBucket,
    acquisition_channel: input.acquisitionChannel,
    acquisition_source_name: input.sourceName.trim() || null,
    acquisition_location: input.sourceLocation.trim() || null,
    external_order_id: input.externalOrderId.trim() || null,
    cost_entry_mode: input.pricingMode,
    actual_item_subtotal: roundMoney(input.itemSubtotal),
    actual_inbound_shipping: roundMoney(input.inboundShipping),
    actual_sales_tax: roundMoney(input.salesTax),
    actual_buyer_fees: roundMoney(input.buyerFees),
    actual_other_cost: roundMoney(input.otherCost),
    actual_out_the_door_cost: total,
    corrected_at: now,
    purchase_correction_history: [...history, correctionEntry],
  };

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_purchase_lots")
    .update({
      purchased_at: new Date(`${input.purchaseDate}T12:00:00`).toISOString(),
      status: nextStatus,
      quantity_purchased: input.quantity,
      item_subtotal: roundMoney(input.itemSubtotal),
      inbound_shipping: roundMoney(input.inboundShipping),
      buyer_fees: roundMoney(input.buyerFees),
      sales_tax: roundMoney(input.salesTax),
      other_acquisition_cost: roundMoney(input.otherCost),
      received_at: receivedAt,
      source_url: input.sourceUrl.trim() || null,
      notes: input.notes.trim() || null,
      metadata: nextMetadata,
    })
    .eq("id", purchaseLotId)
    .select("id,purchase_number,total_acquisition_cost,unit_cost_basis")
    .single();

  if (error) throw new Error(`Unable to update purchase: ${error.message}`);

  return {
    purchaseId: String(data.id),
    purchaseNumber: numberValue(data.purchase_number),
    totalAcquisitionCost: numberValue(data.total_acquisition_cost),
    unitCostBasis: numberValue(data.unit_cost_basis),
  };
}

export async function deleteDuplicateMarketIntelPurchase(
  purchaseLotId: string,
  confirmation: string,
) {
  const existing = await getEditableMarketIntelPurchase(purchaseLotId);
  if (!existing) throw new Error("Purchase was not found.");

  const expected = `DELETE PURCHASE #${existing.purchase_number}`;
  if (confirmation.trim() !== expected) {
    throw new Error(`Type ${expected} exactly to delete this duplicate purchase.`);
  }
  if (existing.sale_count > 0 || existing.quantity_sold > 0) {
    throw new Error(
      "This purchase has recorded sales and cannot be deleted as a duplicate. Correct the purchase instead so realized profit history is preserved.",
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });

  const { error: inboxDeleteError } = await supabase
    .from("tcos_mi_purchase_inbox")
    .delete()
    .eq("purchase_lot_id", purchaseLotId);
  if (inboxDeleteError && !/does not exist|schema cache/i.test(inboxDeleteError.message)) {
    throw new Error(`Unable to remove linked Purchase Inbox row: ${inboxDeleteError.message}`);
  }

  const { error } = await supabase
    .from("tcos_mi_purchase_lots")
    .delete()
    .eq("id", purchaseLotId);
  if (error) {
    throw new Error(
      `Unable to delete duplicate purchase. A linked record may still depend on it: ${error.message}`,
    );
  }

  return {
    purchaseNumber: existing.purchase_number,
    collectibleName: existing.collectible?.display_name || "Unmatched collectible",
  };
}
