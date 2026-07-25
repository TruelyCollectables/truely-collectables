import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncEbayQuantityAfterSale } from "./ebay";
import type { InventoryEngine } from "../modules/inventory";
import { createTransactionEvidenceReport } from "./transaction-evidence";
import {
  createPlatformFeeLedgerForOrder,
  createSellerPayoutLedgerForOrder,
} from "./seller-payout-ledger";
import { getStoreSettings } from "./store-settings";
import { parseCartMetadata } from "./checkout-cart-metadata";
import { isAllowedShippingCountry } from "./shipping-policy";
import {
  consumeCheckoutReservationAfterSale,
  decrementOrderInventoryOnce,
} from "./checkout-inventory-reservations";

export async function finalizeCheckoutOrder(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  event: Stripe.Event;
  session: Stripe.Checkout.Session;
  storeId: string;
  inventoryEngine: InventoryEngine;
}) {
  const { supabase, event, session, storeId, inventoryEngine } = params;
  const metadata = session.metadata || {};
  const collectedInfo = session.collected_information as any;
  const customerEmail =
    session.customer_details?.email || session.customer_email || "unknown";
  const customerName =
    session.customer_details?.name || collectedInfo?.shipping_details?.name || null;
  const shipping = collectedInfo?.shipping_details?.address;
  const shippingCountry = shipping?.country || null;
  const shippingAllowed = isAllowedShippingCountry(shippingCountry);
  const total = Number(session.amount_total || 0) / 100;
  const shippingMethod = metadata.shipping_method || null;
  const shippingName = metadata.shipping_name || null;
  const shippingAmount = Number(metadata.shipping_amount || 0);
  const subtotal = Number(metadata.subtotal || total);
  const itemCount = Number(metadata.item_count || 0);
  const accountId = metadata.account_id || null;
  const offerId = metadata.offer_id;
  const checkoutType = metadata.type || "cart";
  const checkoutAttemptId = metadata.checkout_attempt_id || null;
  const isE2ETest = !event.livemode && metadata.tcos_e2e_checkout === "true";
  const testRunId = isE2ETest ? metadata.tcos_simulation_run_id || null : null;
  const stripePaymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  const stripeChargeId =
    typeof session.payment_intent === "object" && session.payment_intent
      ? typeof session.payment_intent.latest_charge === "string"
        ? session.payment_intent.latest_charge
        : session.payment_intent.latest_charge?.id || null
      : null;

  let rawCart: unknown = parseCartMetadata(metadata.cart);
  if (
    Array.isArray(rawCart) &&
    rawCart.length === 0 &&
    checkoutType === "accepted_offer"
  ) {
    const productId = Number(metadata.product_id);
    if (productId) rawCart = [{ id: productId, quantity: 1 }];
  }

  const cart = inventoryEngine.normalizeCartItems(rawCart);
  const inventoryItems = await inventoryEngine.getByLegacyProductIds(
    cart.map((item) => item.id),
  );
  const productById = new Map(
    inventoryItems.map((item) => [item.legacyProductId, item]),
  );

  for (const cartItem of cart) {
    const product = productById.get(cartItem.id);
    if (!product || !product.inventoryItemId) {
      throw new Error(`Paid product ${cartItem.id} is missing from live inventory.`);
    }
  }

  const normalizedItemCount = cart.reduce(
    (sum, cartItem) => sum + cartItem.quantity,
    0,
  );
  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_session_id", session.id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (existingOrderError) throw existingOrderError;

  const orderPayload = {
    store_id: storeId,
    account_id: accountId,
    customer_email: customerEmail,
    customer_name: customerName,
    total,
    status: shippingAllowed ? "paid" : "paid_shipping_review",
    payment_status: session.payment_status || "paid",
    stripe_payment_intent_id: stripePaymentIntentId,
    stripe_charge_id: stripeChargeId,
    last_payment_event_at: new Date().toISOString(),
    shipping_method: shippingMethod,
    shipping_name: shippingName,
    shipping_amount: shippingAmount,
    subtotal,
    item_count: itemCount || normalizedItemCount,
    fulfillment_status: shippingAllowed ? "ready_to_ship" : "shipping_review",
    shipping_address_line1: shipping?.line1 || null,
    shipping_address_line2: shipping?.line2 || null,
    shipping_city: shipping?.city || null,
    shipping_state: shipping?.state || null,
    shipping_postal_code: shipping?.postal_code || null,
    shipping_country: shippingCountry,
    contains_seller_items: false,
    seller_item_count: 0,
    store_item_count: 0,
    is_test: isE2ETest,
    test_run_id: testRunId,
    tos_accepted: metadata.tos_accepted === "true",
    tos_version: metadata.tos_version || null,
    tos_accepted_at: metadata.tos_accepted_at || null,
    tos_acceptance_event_id: metadata.tos_acceptance_event_id || null,
    tos_ip_address: metadata.tos_ip_address || null,
    tos_user_agent: metadata.tos_user_agent || null,
    tos_ip_risk: metadata.tos_ip_risk || null,
    tos_ip_block_reason: metadata.tos_ip_block_reason || null,
  };

  let orderId: number;
  if (existingOrder) {
    orderId = Number(existingOrder.id);
    const { error } = await supabase
      .from("orders")
      .update(orderPayload)
      .eq("id", orderId)
      .eq("store_id", storeId);
    if (error) throw error;
  } else {
    const { data: order, error } = await supabase
      .from("orders")
      .insert({ ...orderPayload, stripe_session_id: session.id })
      .select("id")
      .single();
    if (error || !order) throw error || new Error("Order insert failed");
    orderId = Number(order.id);
  }

  const { data: existingItems, error: existingItemsError } = await supabase
    .from("order_items")
    .select("product_id")
    .eq("order_id", orderId)
    .eq("store_id", storeId);
  if (existingItemsError) throw existingItemsError;

  const existingProductIds = new Set(
    (existingItems || []).map((item) => Number(item.product_id)),
  );
  let sellerItemCount = 0;
  let storeItemCount = 0;

  for (const cartItem of cart) {
    const product = productById.get(cartItem.id)!;
    if (product.sellerAccountId) sellerItemCount += cartItem.quantity;
    else storeItemCount += cartItem.quantity;

    let mutation;
    try {
      mutation =
        checkoutType === "cart" && checkoutAttemptId
          ? await consumeCheckoutReservationAfterSale({
              supabase,
              storeId,
              checkoutAttemptId,
              legacyProductId: product.legacyProductId,
              quantity: cartItem.quantity,
              stripeSessionId: session.id,
            })
          : await decrementOrderInventoryOnce({
              supabase,
              storeId,
              orderId,
              legacyProductId: product.legacyProductId,
              quantity: cartItem.quantity,
            });
    } catch (inventoryError) {
      await supabase
        .from("orders")
        .update({
          fulfillment_status: "inventory_review",
          status: "paid_inventory_review",
        })
        .eq("id", orderId)
        .eq("store_id", storeId);
      throw inventoryError;
    }

    if (!existingProductIds.has(product.legacyProductId)) {
      const { error: itemError } = await supabase.from("order_items").insert({
        store_id: storeId,
        order_id: orderId,
        product_id: product.legacyProductId,
        seller_account_id: product.sellerAccountId,
        title: product.title,
        price: Number(product.price),
        quantity: cartItem.quantity,
        is_test: isE2ETest,
        test_run_id: testRunId,
      });
      if (itemError) throw itemError;
      existingProductIds.add(product.legacyProductId);
    }

    try {
      await syncEbayQuantityAfterSale({
        sku: product.sku,
        ebayItemId: product.ebayItemId,
        newQuantity: mutation.newQuantity,
      });
    } catch (ebayError: any) {
      console.error("eBay sync after sale failed:", ebayError.message);
    }
  }

  const { error: countUpdateError } = await supabase
    .from("orders")
    .update({
      contains_seller_items: sellerItemCount > 0,
      seller_item_count: sellerItemCount,
      store_item_count: storeItemCount,
    })
    .eq("id", orderId)
    .eq("store_id", storeId);
  if (countUpdateError) throw countUpdateError;

  const { data: ledgerOrderItems, error: ledgerItemsError } = await supabase
    .from("order_items")
    .select("id,product_id,seller_account_id,title,price,quantity")
    .eq("order_id", orderId)
    .eq("store_id", storeId);
  if (ledgerItemsError) throw ledgerItemsError;

  if (ledgerOrderItems && ledgerOrderItems.length > 0) {
    try {
      const storeSettings = await getStoreSettings(supabase, storeId);
      const productIds = Array.from(
        new Set(
          ledgerOrderItems
            .map((item) => Number(item.product_id || 0))
            .filter((productId) => productId > 0),
        ),
      );
      const { data: ledgerInventoryItems } =
        productIds.length === 0
          ? { data: [] }
          : await supabase
              .from("inventory_items")
              .select("legacy_product_id,metadata")
              .eq("store_id", storeId)
              .in("legacy_product_id", productIds);
      const metadataByProductId = new Map(
        (ledgerInventoryItems || []).map((item: any) => [
          Number(item.legacy_product_id || 0),
          item.metadata || {},
        ]),
      );
      const itemsWithMetadata = ledgerOrderItems.map((item) => ({
        ...item,
        metadata: metadataByProductId.get(Number(item.product_id || 0)) || {},
      }));

      await createPlatformFeeLedgerForOrder({
        supabase,
        storeId,
        orderId,
        orderItems: itemsWithMetadata,
        shippingAmount,
        platformFeeRate: storeSettings.sellerCommissionRate,
        stripeSession: session,
      });
      await createSellerPayoutLedgerForOrder({
        supabase,
        storeId,
        orderId,
        orderItems: itemsWithMetadata,
        shippingAmount,
        shippingMethod,
        platformFeeRate: storeSettings.sellerCommissionRate,
        stripeSession: session,
      });
    } catch (ledgerError: any) {
      console.error(
        "Seller payout ledger update failed:",
        ledgerError.message || ledgerError,
      );
    }
  }

  if (checkoutType === "accepted_offer" && offerId) {
    const { error } = await supabase
      .from("offers")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", offerId)
      .eq("store_id", storeId);
    if (error) throw error;
  }

  try {
    await createTransactionEvidenceReport({
      supabase,
      orderId,
      stripeSession: session,
      stripeEvent: event,
      storeId,
    });
  } catch (reportError: any) {
    console.error(
      "Transaction evidence report failed:",
      reportError.message || reportError,
    );
  }

  return { orderId };
}
