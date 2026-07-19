import "server-only";

import { recalculateMarketIntelValue } from "./market-intel-comps";
import { createSupabaseServerClient } from "./supabase-server";

type JsonRecord = Record<string, unknown>;

export type EbayPurchaseCompInput = {
  purchaseId: string;
  purchaseInboxId?: string | null;
  collectibleIdentityId: string;
  marketplaceId: string;
  externalOrderId?: string | null;
  externalListingId?: string | null;
  sourceUrl?: string | null;
  originalTitle?: string | null;
  purchasedAt: string;
  quantity: number;
  itemSubtotal: number;
  inboundShipping: number;
  buyerFees: number;
  salesTax: number;
  otherCost: number;
  totalPaid: number;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clean(value: string | null | undefined) {
  return String(value || "").trim();
}

function stableExternalSaleId(input: EbayPurchaseCompInput) {
  const orderId = clean(input.externalOrderId);
  const listingId = clean(input.externalListingId);
  const inboxId = clean(input.purchaseInboxId);
  if (orderId) {
    return `ebay-buyer-order:${orderId}:item:${listingId || inboxId || input.purchaseId}`;
  }
  if (inboxId) return `ebay-purchase-inbox:${inboxId}`;
  return `tcos-purchase-lot:${input.purchaseId}`;
}

function validDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The eBay purchase date is invalid for sold-comp sync.");
  }
  return date.toISOString();
}

function validateInput(input: EbayPurchaseCompInput) {
  if (!clean(input.purchaseId)) throw new Error("Purchase lot ID is required for comp sync.");
  if (!clean(input.collectibleIdentityId)) {
    throw new Error("Exact collectible identity is required for comp sync.");
  }
  if (!clean(input.marketplaceId)) throw new Error("Marketplace is required for comp sync.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Comp quantity must be a positive whole number.");
  }
  for (const [label, value] of [
    ["item subtotal", input.itemSubtotal],
    ["inbound shipping", input.inboundShipping],
    ["buyer fees", input.buyerFees],
    ["sales tax", input.salesTax],
    ["other cost", input.otherCost],
    ["total paid", input.totalPaid],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`The ${label} must be zero or greater for comp sync.`);
    }
  }
}

export async function syncEbayPurchaseReceiptComp(input: EbayPurchaseCompInput) {
  validateInput(input);
  const supabase = createSupabaseServerClient({ admin: true });
  const externalSaleId = stableExternalSaleId(input);
  const soldAt = validDate(input.purchasedAt);
  const metadata: JsonRecord = {
    source: "ebay_buyer_order_receipt",
    verified_from: "connected_ebay_purchase_inbox",
    purchase_lot_id: input.purchaseId,
    purchase_inbox_id: clean(input.purchaseInboxId) || null,
    ebay_order_id: clean(input.externalOrderId) || null,
    ebay_listing_id: clean(input.externalListingId) || null,
    actual_item_subtotal: roundMoney(input.itemSubtotal),
    actual_inbound_shipping: roundMoney(input.inboundShipping),
    actual_buyer_fees: roundMoney(input.buyerFees),
    actual_sales_tax: roundMoney(input.salesTax),
    actual_other_cost: roundMoney(input.otherCost),
    actual_out_the_door_cost: roundMoney(input.totalPaid),
    comparable_comp_value_excludes_sales_tax: true,
    comparable_comp_value_excludes_other_acquisition_cost: true,
    synced_at: new Date().toISOString(),
  };

  const { data: existing, error: lookupError } = await supabase
    .from("tcos_mi_sold_comps")
    .select("id,metadata")
    .eq("collectible_identity_id", input.collectibleIdentityId)
    .eq("external_sale_id", externalSaleId)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const payload = {
    marketplace_id: input.marketplaceId,
    collectible_identity_id: input.collectibleIdentityId,
    external_sale_id: externalSaleId,
    source_url: clean(input.sourceUrl) || null,
    original_title: clean(input.originalTitle) || null,
    sold_at: soldAt,
    sold_price: roundMoney(input.itemSubtotal),
    shipping_price: roundMoney(input.inboundShipping),
    buyer_fee: roundMoney(input.buyerFees),
    quantity: input.quantity,
    verified: true,
    match_confidence: 100,
    excluded: false,
    exclusion_reason: null,
    outlier_flag: false,
    metadata: {
      ...(existing?.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as JsonRecord)
        : {}),
      ...metadata,
    },
  };

  let status: "created" | "updated";
  let compId: string;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("tcos_mi_sold_comps")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    compId = String(data.id);
    status = "updated";
  } else {
    const { data, error } = await supabase
      .from("tcos_mi_sold_comps")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    compId = String(data.id);
    status = "created";
  }

  const market = await recalculateMarketIntelValue(input.collectibleIdentityId);
  return {
    status,
    compId,
    externalSaleId,
    identityId: input.collectibleIdentityId,
    market,
  };
}

export async function backfillRecordedEbayPurchaseComps(limit = 500) {
  const supabase = createSupabaseServerClient({ admin: true });
  const safeLimit = Math.max(1, Math.min(1000, Math.round(limit)));
  const { data: inboxRows, error: inboxError } = await supabase
    .from("tcos_mi_purchase_inbox")
    .select(
      "id,marketplace_id,external_order_id,external_listing_id,direct_url,title,purchased_at,quantity,item_subtotal,inbound_shipping,sales_tax,buyer_fees,other_cost,total_paid,purchase_lot_id,status",
    )
    .eq("status", "recorded")
    .not("purchase_lot_id", "is", null)
    .order("purchased_at", { ascending: true })
    .limit(safeLimit);
  if (inboxError) throw new Error(inboxError.message);

  const purchaseIds = Array.from(
    new Set((inboxRows || []).map((row) => String(row.purchase_lot_id)).filter(Boolean)),
  );
  const { data: purchaseRows, error: purchaseError } = purchaseIds.length
    ? await supabase
        .from("tcos_mi_purchase_lots")
        .select(
          "id,collectible_identity_id,marketplace_id,purchased_at,quantity_purchased,item_subtotal,inbound_shipping,buyer_fees,sales_tax,other_acquisition_cost,total_acquisition_cost,source_url",
        )
        .in("id", purchaseIds)
    : { data: [], error: null };
  if (purchaseError) throw new Error(purchaseError.message);

  const purchaseById = new Map(
    (purchaseRows || []).map((row) => [String(row.id), row]),
  );
  const result = {
    requested: (inboxRows || []).length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as Array<{ inboxId: string; message: string }>,
  };

  for (const inbox of inboxRows || []) {
    const purchase = purchaseById.get(String(inbox.purchase_lot_id));
    if (!purchase?.collectible_identity_id) {
      result.skipped += 1;
      result.errors.push({
        inboxId: String(inbox.id),
        message: "Recorded purchase is missing an exact collectible identity.",
      });
      continue;
    }

    try {
      const synced = await syncEbayPurchaseReceiptComp({
        purchaseId: String(purchase.id),
        purchaseInboxId: String(inbox.id),
        collectibleIdentityId: String(purchase.collectible_identity_id),
        marketplaceId: String(purchase.marketplace_id || inbox.marketplace_id),
        externalOrderId: inbox.external_order_id ? String(inbox.external_order_id) : null,
        externalListingId: inbox.external_listing_id
          ? String(inbox.external_listing_id)
          : null,
        sourceUrl: purchase.source_url
          ? String(purchase.source_url)
          : String(inbox.direct_url || ""),
        originalTitle: String(inbox.title || ""),
        purchasedAt: String(purchase.purchased_at || inbox.purchased_at),
        quantity: Math.max(
          1,
          Math.round(numberValue(purchase.quantity_purchased, numberValue(inbox.quantity, 1))),
        ),
        itemSubtotal: numberValue(purchase.item_subtotal, numberValue(inbox.item_subtotal)),
        inboundShipping: numberValue(
          purchase.inbound_shipping,
          numberValue(inbox.inbound_shipping),
        ),
        buyerFees: numberValue(purchase.buyer_fees, numberValue(inbox.buyer_fees)),
        salesTax: numberValue(purchase.sales_tax, numberValue(inbox.sales_tax)),
        otherCost: numberValue(
          purchase.other_acquisition_cost,
          numberValue(inbox.other_cost),
        ),
        totalPaid: numberValue(
          purchase.total_acquisition_cost,
          numberValue(inbox.total_paid),
        ),
      });
      result[synced.status] += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({
        inboxId: String(inbox.id),
        message: error instanceof Error ? error.message : "Unable to sync receipt comp.",
      });
    }
  }

  return result;
}
