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
import { selectedCheckoutShipping } from "./stripe-selected-shipping";
import { persistBuyerProtectionForOrder } from "./buyer-protection-order";
import { enqueueAndAttemptOrderNotification } from "./order-notifications";
import { loadStripePaidCheckoutAmounts } from "./stripe-paid-item-prices";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function moneyMatches(left: unknown, right: unknown) {
  return Math.round(money(left) * 100) === Math.round(money(right) * 100);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

async function markOrderReview(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  status: string;
  fulfillmentStatus: string;
}) {
  const { error } = await params.supabase
    .from("orders")
    .update({
      status: params.status,
      fulfillment_status: params.fulfillmentStatus,
      last_payment_event_at: new Date().toISOString(),
    })
    .eq("id", params.orderId)
    .eq("store_id", params.storeId);
  if (error) throw error;
}

export async function finalizeCheckoutOrder(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  event: Stripe.Event;
  session: Stripe.Checkout.Session;
  storeId: string;
  inventoryEngine: InventoryEngine;
}) {
  const { supabase, stripe, event, session, storeId, inventoryEngine } = params;
  const metadata = session.metadata || {};

  if (
    event.type !== "checkout.session.completed" ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    throw new Error("The Stripe event is not a completed paid Checkout Session.");
  }
  if (session.livemode !== event.livemode) {
    throw new Error("The Stripe event and Checkout Session payment modes disagree.");
  }
  if (metadata.store_id !== storeId) {
    throw new Error("The paid Checkout Session does not belong to the active store.");
  }

  const collectedInfo = session.collected_information as any;
  const legacyShippingDetails = (session as any).shipping_details;
  const shippingDetails =
    collectedInfo?.shipping_details || legacyShippingDetails || null;
  const customerEmail = String(
    session.customer_details?.email || session.customer_email || "unknown",
  )
    .trim()
    .toLowerCase();
  const customerName =
    session.customer_details?.name || shippingDetails?.name || null;
  const shipping = shippingDetails?.address || null;
  const shippingCountry = shipping?.country || null;
  const shippingAllowed = isAllowedShippingCountry(shippingCountry);
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

  const paidAmounts = await loadStripePaidCheckoutAmounts({
    stripe,
    session,
    expectedItems: cart,
    checkoutType,
    metadata,
  });
  const selectedShipping = await selectedCheckoutShipping({
    stripe,
    session,
    metadata,
  });
  const shippingMethod = selectedShipping.method;
  const shippingName = selectedShipping.name;
  const total = paidAmounts.total;
  const subtotal = paidAmounts.itemSubtotal;
  const shippingAmount = paidAmounts.shippingAmount;
  const buyerProtectionAmount = paidAmounts.buyerProtectionAmount;
  const normalizedItemCount = cart.reduce(
    (sum, cartItem) => sum + cartItem.quantity,
    0,
  );

  const paymentReviewReasons: string[] = [];
  if (!moneyMatches(metadata.subtotal, subtotal)) {
    paymentReviewReasons.push("metadata_subtotal_mismatch");
  }
  if (!moneyMatches(metadata.shipping_amount, shippingAmount)) {
    paymentReviewReasons.push("metadata_shipping_mismatch");
  }
  if (!moneyMatches(selectedShipping.amount, shippingAmount)) {
    paymentReviewReasons.push("selected_shipping_mismatch");
  }
  const metadataProtectionSelected =
    metadata.buyer_protection_selected === "true";
  if (metadataProtectionSelected !== (buyerProtectionAmount > 0)) {
    paymentReviewReasons.push("buyer_protection_selection_mismatch");
  }
  if (
    metadataProtectionSelected &&
    !moneyMatches(metadata.buyer_protection_fee, buyerProtectionAmount)
  ) {
    paymentReviewReasons.push("buyer_protection_fee_mismatch");
  }
  if (Number(metadata.item_count || normalizedItemCount) !== normalizedItemCount) {
    paymentReviewReasons.push("item_count_mismatch");
  }

  const paymentReviewRequired = paymentReviewReasons.length > 0;
  const initialStatus = paymentReviewRequired
    ? "paid_payment_review"
    : shippingAllowed
      ? "paid"
      : "paid_shipping_review";
  const initialFulfillmentStatus = paymentReviewRequired
    ? "payment_review"
    : shippingAllowed
      ? "ready_to_ship"
      : "shipping_review";
  const now = new Date().toISOString();

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select("id,status,fulfillment_status")
    .eq("stripe_session_id", session.id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (existingOrderError) throw existingOrderError;

  const stableOrderPayload = {
    account_id: accountId,
    customer_email: customerEmail,
    customer_name: customerName,
    total,
    payment_status: session.payment_status,
    stripe_payment_intent_id: stripePaymentIntentId,
    stripe_charge_id: stripeChargeId,
    last_payment_event_at: now,
    shipping_method: shippingMethod,
    shipping_name: shippingName,
    shipping_amount: shippingAmount,
    subtotal,
    item_count: normalizedItemCount,
    shipping_address_line1: shipping?.line1 || null,
    shipping_address_line2: shipping?.line2 || null,
    shipping_city: shipping?.city || null,
    shipping_state: shipping?.state || null,
    shipping_postal_code: shipping?.postal_code || null,
    shipping_country: shippingCountry,
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
    const existingStatus = String(existingOrder.status || "");
    const existingFulfillment = String(existingOrder.fulfillment_status || "");
    const mayApplySafetyReview = ![
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
      "disputed",
    ].some(
      (value) =>
        existingStatus.includes(value) || existingFulfillment.includes(value),
    );
    const { error } = await supabase
      .from("orders")
      .update({
        ...stableOrderPayload,
        ...(paymentReviewRequired && mayApplySafetyReview
          ? {
              status: initialStatus,
              fulfillment_status: initialFulfillmentStatus,
            }
          : {}),
      })
      .eq("id", orderId)
      .eq("store_id", storeId);
    if (error) throw error;
  } else {
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        store_id: storeId,
        ...stableOrderPayload,
        status: initialStatus,
        fulfillment_status: initialFulfillmentStatus,
        contains_seller_items: false,
        seller_item_count: 0,
        store_item_count: 0,
        stripe_session_id: session.id,
      })
      .select("id")
      .single();
    if (error || !order) throw error || new Error("Order insert failed");
    orderId = Number(order.id);
  }

  if (paymentReviewRequired) {
    console.error(
      `Paid order ${orderId} requires amount review: ${paymentReviewReasons.join(", ")}`,
    );
  }

  try {
    await persistBuyerProtectionForOrder({
      supabase,
      storeId,
      orderId,
      accountId,
      shippingMethod,
      metadata,
      isTest: isE2ETest,
      paidFeeAmount: buyerProtectionAmount,
      paidItemSubtotal: subtotal,
    });
  } catch (protectionError) {
    await markOrderReview({
      supabase,
      storeId,
      orderId,
      status: "paid_payment_review",
      fulfillmentStatus: "payment_review",
    });
    throw protectionError;
  }

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
      await markOrderReview({
        supabase,
        storeId,
        orderId,
        status: "paid_inventory_review",
        fulfillmentStatus: "inventory_review",
      });
      throw inventoryError;
    }

    const paidUnitPrice = paidAmounts.unitPrices.get(product.legacyProductId);
    if (paidUnitPrice === undefined) {
      await markOrderReview({
        supabase,
        storeId,
        orderId,
        status: "paid_payment_review",
        fulfillmentStatus: "payment_review",
      });
      throw new Error(
        `The paid unit price for product ${product.legacyProductId} is unavailable.`,
      );
    }

    const { error: itemError } = await supabase.from("order_items").upsert(
      {
        store_id: storeId,
        order_id: orderId,
        product_id: product.legacyProductId,
        seller_account_id: product.sellerAccountId,
        title: product.title,
        price: paidUnitPrice,
        quantity: cartItem.quantity,
        is_test: isE2ETest,
        test_run_id: testRunId,
      },
      { onConflict: "store_id,order_id,product_id" },
    );
    if (itemError) throw itemError;

    try {
      const immediateSync = await syncEbayQuantityAfterSale({
        sku: product.sku,
        ebayItemId: product.ebayItemId,
        newQuantity: mutation.newQuantity,
      });
      if (!immediateSync.success) {
        console.error(
          "Immediate eBay sync after sale was deferred to the durable outbox:",
          immediateSync.reason || "unknown reason",
        );
      }
    } catch (ebayError: any) {
      console.error(
        "Immediate eBay sync after sale failed; durable outbox will retry:",
        ebayError?.message || ebayError,
      );
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
  if (!ledgerOrderItems || ledgerOrderItems.length !== cart.length) {
    await markOrderReview({
      supabase,
      storeId,
      orderId,
      status: "paid_financial_review",
      fulfillmentStatus: "financial_review",
    });
    throw new Error("The paid order item ledger does not cover every cart line.");
  }

  try {
    const storeSettings = await getStoreSettings(supabase, storeId);
    const productIds = Array.from(
      new Set(
        ledgerOrderItems
          .map((item) => Number(item.product_id || 0))
          .filter((productId) => productId > 0),
      ),
    );
    const { data: ledgerInventoryItems, error: ledgerInventoryError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("inventory_items")
            .select("legacy_product_id,metadata")
            .eq("store_id", storeId)
            .in("legacy_product_id", productIds);
    if (ledgerInventoryError) throw ledgerInventoryError;
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
  } catch (ledgerError) {
    await markOrderReview({
      supabase,
      storeId,
      orderId,
      status: "paid_financial_review",
      fulfillmentStatus: "financial_review",
    });
    throw ledgerError;
  }

  if (checkoutType === "accepted_offer" && offerId) {
    const { data: paidOffer, error } = await supabase
      .from("offers")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", offerId)
      .eq("store_id", storeId)
      .in("status", ["accepted", "countered", "paid"])
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!paidOffer) {
      await markOrderReview({
        supabase,
        storeId,
        orderId,
        status: "paid_offer_review",
        fulfillmentStatus: "offer_review",
      });
      throw new Error("The paid accepted offer could not be finalized safely.");
    }
  }

  try {
    await createTransactionEvidenceReport({
      supabase,
      orderId,
      stripeSession: session,
      stripeEvent: event,
      storeId,
    });
  } catch (reportError) {
    await markOrderReview({
      supabase,
      storeId,
      orderId,
      status: "paid_financial_review",
      fulfillmentStatus: "financial_review",
    });
    throw reportError;
  }

  if (!isE2ETest && isValidEmail(customerEmail)) {
    const notification = await enqueueAndAttemptOrderNotification({
      supabase,
      storeId,
      orderId,
      notificationType: "payment_confirmation",
      recipientEmail: customerEmail,
      recipientName: customerName,
      payload: {
        orderId,
        customerName,
        total,
        subtotal,
        shippingAmount,
        shippingName,
        items: ledgerOrderItems.map((item) => ({
          title: String(item.title || "Item"),
          quantity: Number(item.quantity || 1),
          price: Number(item.price || 0),
        })),
      },
    });
    if (notification && !notification.sent) {
      console.error(
        `Payment confirmation for order ${orderId} is queued for retry: ${notification.error || notification.status}`,
      );
    }
  }

  if (
    existingOrder &&
    String(existingOrder.status || "") === "paid_inventory_review" &&
    !paymentReviewRequired
  ) {
    await markOrderReview({
      supabase,
      storeId,
      orderId,
      status: shippingAllowed ? "paid" : "paid_shipping_review",
      fulfillmentStatus: shippingAllowed ? "ready_to_ship" : "shipping_review",
    });
  }

  return {
    orderId,
    paymentReviewRequired,
    paymentReviewReasons,
    paidAmounts: {
      total,
      subtotal,
      shippingAmount,
      buyerProtectionAmount,
    },
  };
}
