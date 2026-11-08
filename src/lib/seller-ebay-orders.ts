import type { SupabaseClient } from "@supabase/supabase-js";
import { getSellerEbayAccessToken } from "./seller-ebay";
import { fetchSellerEbayRemoteState } from "./seller-ebay-reconciliation";

export const EBAY_FULFILLMENT_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment";

const ORDER_BATCH_SIZE = 25;
const INITIAL_LOOKBACK_DAYS = 90;
const OVERLAP_HOURS = 48;

type ConnectionRow = {
  id: string;
  oauth_scope: string[] | null;
  import_cursor: Record<string, unknown> | null;
  provider_metadata: Record<string, unknown> | null;
};

type ProductRow = {
  id: number;
  sku: string | null;
  quantity: number | null;
  ebay_item_id: string | null;
};

type QuantityCeilingRow = {
  inventory_item_id: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  inventory_status: string | null;
};

export type SellerEbayOutsideOrder = {
  id: string;
  providerOrderId: string;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  cancelState: string | null;
  orderTotal: number;
  currency: string;
  providerCreatedAt: string | null;
  providerModifiedAt: string | null;
  lastImportedAt: string | null;
};

export type SellerEbayOrderImportStatus = {
  orderCount: number;
  paidCount: number;
  refundedCount: number;
  unmatchedItemCount: number;
  latestImportedAt: string | null;
  recentOrders: SellerEbayOutsideOrder[];
};

export type SellerEbayOrderImportResult = {
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  totalAvailable: number;
  importedOrderCount: number;
  importedItemCount: number;
  inventoryReducedCount: number;
  soldCount: number;
  unmatchedItemCount: number;
  reviewCount: number;
  failedItemCount: number;
  windowStart: string;
  windowEnd: string;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function amountValue(value: unknown) {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).value
      : value;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : 0;
}

function amountCurrency(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return textValue((value as Record<string, unknown>).currency);
}

function cleanDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function ebayApiBase(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function mapOrder(row: any): SellerEbayOutsideOrder {
  return {
    id: String(row.id),
    providerOrderId: String(row.provider_order_id),
    paymentStatus: textValue(row.payment_status),
    fulfillmentStatus: textValue(row.fulfillment_status),
    cancelState: textValue(row.cancel_state),
    orderTotal: amountValue(row.order_total),
    currency: String(row.currency || "USD"),
    providerCreatedAt: cleanDate(row.provider_created_at),
    providerModifiedAt: cleanDate(row.provider_modified_at),
    lastImportedAt: cleanDate(row.last_imported_at),
  };
}

async function findSellerProduct(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  listingId: string | null;
  sku: string | null;
}) {
  if (params.listingId) {
    const { data, error } = await params.supabase
      .from("products")
      .select("id,sku,quantity,ebay_item_id")
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId)
      .eq("ebay_item_id", params.listingId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as ProductRow;
  }

  if (params.sku) {
    const { data, error } = await params.supabase
      .from("products")
      .select("id,sku,quantity,ebay_item_id")
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.accountId)
      .eq("sku", params.sku)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as ProductRow;
  }

  return null;
}

export async function loadSellerEbayOrderImportStatus(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
}): Promise<SellerEbayOrderImportStatus> {
  const [orders, paid, refunded, unmatched, recent] = await Promise.all([
    params.supabase
      .from("seller_marketplace_orders")
      .select("id", { count: "exact", head: true })
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId)
      .eq("provider", "ebay"),
    params.supabase
      .from("seller_marketplace_orders")
      .select("id", { count: "exact", head: true })
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId)
      .eq("provider", "ebay")
      .eq("payment_status", "PAID"),
    params.supabase
      .from("seller_marketplace_orders")
      .select("id", { count: "exact", head: true })
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId)
      .eq("provider", "ebay")
      .in("payment_status", ["FULLY_REFUNDED", "PARTIALLY_REFUNDED"]),
    params.supabase
      .from("seller_marketplace_order_items")
      .select("id", { count: "exact", head: true })
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId)
      .eq("provider", "ebay")
      .eq("inventory_action", "unmatched"),
    params.supabase
      .from("seller_marketplace_orders")
      .select(
        "id,provider_order_id,payment_status,fulfillment_status,cancel_state,order_total,currency,provider_created_at,provider_modified_at,last_imported_at",
      )
      .eq("account_id", params.accountId)
      .eq("store_id", params.storeId)
      .eq("provider", "ebay")
      .order("provider_created_at", { ascending: false })
      .limit(10),
  ]);

  if (orders.error) throw orders.error;
  if (paid.error) throw paid.error;
  if (refunded.error) throw refunded.error;
  if (unmatched.error) throw unmatched.error;
  if (recent.error) throw recent.error;

  const recentOrders = (recent.data || []).map(mapOrder);

  return {
    orderCount: orders.count || 0,
    paidCount: paid.count || 0,
    refundedCount: refunded.count || 0,
    unmatchedItemCount: unmatched.count || 0,
    latestImportedAt: recentOrders
      .map((order) => order.lastImportedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null,
    recentOrders,
  };
}

export async function importSellerEbayOrdersBatch(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  resetCursor?: boolean;
  source?: "seller_manual" | "scheduled_cron";
}): Promise<SellerEbayOrderImportResult> {
  const source = params.source || "seller_manual";
  const auth = await getSellerEbayAccessToken({
    supabase: params.supabase,
    accountId: params.accountId,
    storeId: params.storeId,
  });
  const { data: connection, error: connectionError } = await params.supabase
    .from("seller_marketplace_connections")
    .select("id,oauth_scope,import_cursor,provider_metadata")
    .eq("id", auth.connectionId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .single();

  if (connectionError || !connection) {
    throw connectionError || new Error("Seller eBay connection was not found.");
  }

  const connectionRow = connection as unknown as ConnectionRow;

  if (!(connectionRow.oauth_scope || []).includes(EBAY_FULFILLMENT_SCOPE)) {
    throw new Error(
      "Reconnect eBay once to grant order-import permission before importing outside sales.",
    );
  }

  const cursor = recordValue(connectionRow.import_cursor);
  const continuing =
    params.resetCursor !== true &&
    cursor.order_import_has_more === true &&
    cleanDate(cursor.order_import_window_start) &&
    cleanDate(cursor.order_import_window_end);
  const now = new Date();
  const previousSuccess =
    params.resetCursor === true
      ? null
      : cleanDate(cursor.order_import_last_success_at);
  const initialStart = previousSuccess
    ? new Date(
        new Date(previousSuccess).getTime() - OVERLAP_HOURS * 60 * 60 * 1000,
      )
    : new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const windowStart = continuing
    ? cleanDate(cursor.order_import_window_start)!
    : initialStart.toISOString();
  const windowEnd = continuing
    ? cleanDate(cursor.order_import_window_end)!
    : now.toISOString();
  const offset = continuing
    ? nonNegativeInteger(cursor.order_import_next_offset)
    : 0;
  const query = new URLSearchParams({
    filter: `lastmodifieddate:[${windowStart}..${windowEnd}]`,
    limit: String(ORDER_BATCH_SIZE),
    offset: String(offset),
  });
  const apiBase = ebayApiBase(auth.ebayEnvironment);
  const response = await fetch(
    `${apiBase}/sell/fulfillment/v1/order?${query.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
    },
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
        data?.message ||
        `eBay order import failed with ${response.status}`,
    );
  }

  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const totalAvailable = nonNegativeInteger(data?.total);
  const counters = {
    importedOrders: 0,
    importedItems: 0,
    inventoryReduced: 0,
    sold: 0,
    unmatched: 0,
    review: 0,
    failed: 0,
  };

  for (const order of orders) {
    const providerOrderId = textValue(order?.orderId);
    if (!providerOrderId) continue;

    const paymentStatus = textValue(order?.orderPaymentStatus);
    const fulfillmentStatus = textValue(order?.orderFulfillmentStatus);
    const cancelState = textValue(order?.cancelStatus?.cancelState);
    const providerCreatedAt = cleanDate(order?.creationDate);
    const providerModifiedAt = cleanDate(order?.lastModifiedDate);
    const totalContainer = order?.pricingSummary?.total;
    const currency =
      amountCurrency(totalContainer) ||
      amountCurrency(order?.pricingSummary?.priceSubtotal) ||
      "USD";
    const importedAt = new Date().toISOString();
    const { data: savedOrder, error: orderError } = await params.supabase
      .from("seller_marketplace_orders")
      .upsert(
        {
          account_id: params.accountId,
          store_id: params.storeId,
          connection_id: auth.connectionId,
          provider: "ebay",
          provider_order_id: providerOrderId,
          payment_status: paymentStatus,
          fulfillment_status: fulfillmentStatus,
          cancel_state: cancelState,
          currency,
          subtotal: amountValue(order?.pricingSummary?.priceSubtotal),
          delivery_total: amountValue(order?.pricingSummary?.deliveryCost),
          tax_total: amountValue(order?.pricingSummary?.tax),
          order_total: amountValue(totalContainer),
          marketplace_fee: amountValue(order?.totalMarketplaceFee),
          fee_eligible: false,
          platform_fee_rate: 0,
          platform_fee_amount: 0,
          provider_created_at: providerCreatedAt,
          provider_modified_at: providerModifiedAt,
          last_imported_at: importedAt,
          metadata: {
            source,
            outside_marketplace_sale: true,
            tcos_checkout_order: false,
            tcos_fee_eligible: false,
            ebay_collect_and_remit_tax: order?.ebayCollectAndRemitTax === true,
          },
          updated_at: importedAt,
        },
        { onConflict: "store_id,account_id,provider,provider_order_id" },
      )
      .select("id")
      .single();

    if (orderError || !savedOrder?.id) {
      throw orderError || new Error("Could not save imported eBay order.");
    }

    counters.importedOrders += 1;
    const orderId = String(savedOrder.id);
    const eventKey = [
      providerModifiedAt || providerCreatedAt || "unknown",
      paymentStatus || "unknown",
      fulfillmentStatus || "unknown",
      cancelState || "unknown",
    ].join("|");
    const { error: eventError } = await params.supabase
      .from("seller_marketplace_order_events")
      .upsert(
        {
          order_id: orderId,
          account_id: params.accountId,
          store_id: params.storeId,
          connection_id: auth.connectionId,
          provider: "ebay",
          event_key: eventKey,
          payment_status: paymentStatus,
          fulfillment_status: fulfillmentStatus,
          cancel_state: cancelState,
          provider_modified_at: providerModifiedAt,
          metadata: { source, outside_marketplace_sale: true },
        },
        { onConflict: "order_id,event_key", ignoreDuplicates: true },
      );

    if (eventError) throw eventError;

    const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];

    for (const lineItem of lineItems) {
      const lineItemId = textValue(lineItem?.lineItemId);
      if (!lineItemId) continue;

      const sku = textValue(lineItem?.sku);
      const listingId = textValue(lineItem?.legacyItemId);
      const quantity = nonNegativeInteger(lineItem?.quantity);
      let product: ProductRow | null = null;
      let inventoryItemId: string | null = null;
      let inventoryAction = "pending";
      const reasons: string[] = [];

      try {
        product = await findSellerProduct({
          supabase: params.supabase,
          accountId: params.accountId,
          storeId: params.storeId,
          listingId,
          sku,
        });

        if (!product) {
          inventoryAction = "unmatched";
          counters.unmatched += 1;
          reasons.push("seller_inventory_match_not_found");
        } else {
          const effectiveSku = textValue(product.sku) || sku;

          if (!effectiveSku) {
            inventoryAction = "needs_review";
            counters.review += 1;
            reasons.push("matched_product_missing_sku");
          } else {
            const remote = await fetchSellerEbayRemoteState({
              apiBase,
              accessToken: auth.accessToken,
              sku: effectiveSku,
              expectedListingId: listingId || textValue(product.ebay_item_id),
            });

            if (!remote.found || remote.quantity === null) {
              inventoryAction = "needs_review";
              counters.review += 1;
              reasons.push(remote.warning || "remote_quantity_unavailable");
            } else {
              const { data: ceilingData, error: ceilingError } =
                await params.supabase.rpc(
                  "tcos_apply_seller_ebay_quantity_ceiling",
                  {
                    p_store_id: params.storeId,
                    p_account_id: params.accountId,
                    p_legacy_product_id: product.id,
                    p_remote_quantity: remote.quantity,
                    p_reconciliation_metadata: {
                      source: "ebay_outside_order_import",
                      provider_order_id: providerOrderId,
                      provider_line_item_id: lineItemId,
                      remote_quantity: remote.quantity,
                      tcos_fee_eligible: false,
                    },
                  },
                );

              if (ceilingError) throw ceilingError;
              const ceiling = (Array.isArray(ceilingData)
                ? ceilingData[0]
                : ceilingData) as QuantityCeilingRow | null;
              const before = nonNegativeInteger(
                ceiling?.previous_quantity ?? product.quantity,
              );
              const after = nonNegativeInteger(
                ceiling?.new_quantity ?? product.quantity,
              );
              inventoryItemId = ceiling?.inventory_item_id || null;

              if (
                ["FULLY_REFUNDED", "PARTIALLY_REFUNDED"].includes(
                  paymentStatus || "",
                ) ||
                (cancelState && cancelState !== "NONE_REQUESTED")
              ) {
                inventoryAction = "needs_review";
                counters.review += 1;
                reasons.push("refund_or_cancellation_never_auto_restores_stock");
              } else if (after < before && after === 0) {
                inventoryAction = "sold";
                counters.sold += 1;
              } else if (after < before) {
                inventoryAction = "quantity_reduced";
                counters.inventoryReduced += 1;
              } else {
                inventoryAction = "unchanged";
              }
            }
          }
        }
      } catch (error: any) {
        inventoryAction = "failed";
        counters.failed += 1;
        reasons.push(
          String(error.message || "Inventory adjustment failed").slice(0, 300),
        );
      }

      const { error: itemError } = await params.supabase
        .from("seller_marketplace_order_items")
        .upsert(
          {
            order_id: orderId,
            account_id: params.accountId,
            store_id: params.storeId,
            connection_id: auth.connectionId,
            provider: "ebay",
            provider_line_item_id: lineItemId,
            provider_listing_id: listingId,
            sku,
            title: textValue(lineItem?.title),
            quantity,
            line_total: amountValue(lineItem?.lineItemCost),
            currency:
              amountCurrency(lineItem?.lineItemCost) || currency,
            fulfillment_status: textValue(
              lineItem?.lineItemFulfillmentStatus,
            ),
            sold_format: textValue(lineItem?.soldFormat),
            legacy_product_id: product?.id || null,
            inventory_item_id: inventoryItemId,
            inventory_action: inventoryAction,
            metadata: {
              reasons,
              outside_marketplace_sale: true,
              tcos_fee_eligible: false,
              auto_restore_inventory: false,
            },
            updated_at: importedAt,
          },
          { onConflict: "order_id,provider_line_item_id" },
        );

      if (itemError) throw itemError;
      counters.importedItems += 1;
    }
  }

  const nextRawOffset = offset + orders.length;
  const hasMore = nextRawOffset < totalAvailable;
  const nextOffset = hasMore ? nextRawOffset : 0;
  const completedAt = new Date().toISOString();
  const summary = {
    source,
    window_start: windowStart,
    window_end: windowEnd,
    offset,
    next_offset: nextOffset,
    has_more: hasMore,
    total_available: totalAvailable,
    imported_order_count: counters.importedOrders,
    imported_item_count: counters.importedItems,
    inventory_reduced_count: counters.inventoryReduced,
    sold_count: counters.sold,
    unmatched_item_count: counters.unmatched,
    review_count: counters.review,
    failed_item_count: counters.failed,
    outside_sale_fee_applied: false,
    completed_at: completedAt,
  };

  const { error: cursorError } = await params.supabase
    .from("seller_marketplace_connections")
    .update({
      import_cursor: {
        ...cursor,
        order_import_window_start: hasMore ? windowStart : null,
        order_import_window_end: hasMore ? windowEnd : null,
        order_import_next_offset: nextOffset,
        order_import_has_more: hasMore,
        order_import_last_success_at: hasMore
          ? cursor.order_import_last_success_at || null
          : windowEnd,
        order_import_completed_at: completedAt,
      },
      provider_metadata: {
        ...recordValue(connectionRow.provider_metadata),
        latest_order_import: summary,
      },
      last_sync_error:
        counters.failed > 0
          ? `${counters.failed} outside-order item(s) failed inventory processing.`
          : null,
      updated_at: completedAt,
    })
    .eq("id", auth.connectionId)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId);

  if (cursorError) throw cursorError;

  return {
    offset,
    nextOffset,
    hasMore,
    totalAvailable,
    importedOrderCount: counters.importedOrders,
    importedItemCount: counters.importedItems,
    inventoryReducedCount: counters.inventoryReduced,
    soldCount: counters.sold,
    unmatchedItemCount: counters.unmatched,
    reviewCount: counters.review,
    failedItemCount: counters.failed,
    windowStart,
    windowEnd,
  };
}
