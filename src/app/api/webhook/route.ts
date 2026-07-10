import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { syncEbayQuantityAfterSale } from "../../../lib/ebay";
import { InventoryEngine, InventoryRepository } from "../../../modules/inventory";
import { createTransactionEvidenceReport } from "../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../lib/stores";
import { updateSellerPayoutAccountFromStripe } from "../../../lib/seller-payouts";
import {
  createPlatformFeeLedgerForOrder,
  createSellerPayoutLedgerForOrder,
} from "../../../lib/seller-payout-ledger";
import { getStoreSettings } from "../../../lib/store-settings";
import { evaluateAccountCardVerification } from "../../../lib/account-card-verification";
import { parseCartMetadata } from "../../../lib/checkout-cart-metadata";
import { isAllowedShippingCountry } from "../../../lib/shipping-policy";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import {
  claimStripeWebhookEvent,
  failStripeWebhookEvent,
  finishStripeWebhookEvent,
  stripeWebhookPayloadHash,
} from "../../../lib/stripe-webhook-events";
import {
  processStripeDisputeEvent,
  processStripeRefundEvent,
} from "../../../lib/stripe-post-payment";
import { prepareStripeDisputeEvidence } from "../../../lib/stripe-dispute-evidence";
import { stripePaymentSimulationRunId } from "../../../lib/stripe-payment-simulation-events";
import {
  getStripeLiveSecretKey,
  getStripeLiveWebhookSecret,
  getStripeTestSecretKey,
  getStripeTestWebhookSecret,
} from "../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";

const REFUND_EVENT_TYPES = new Set([
  "refund.created",
  "refund.updated",
  "refund.failed",
]);
const DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);

export async function POST(req: Request) {
  let journal:
    | { supabase: SupabaseClient; webhookEventId: string }
    | null = null;

  try {
    const credentialCandidates = [
      {
        livemode: false,
        stripeKey: getStripeTestSecretKey(),
        webhookSecret: getStripeTestWebhookSecret(),
      },
      {
        livemode: true,
        stripeKey: getStripeLiveSecretKey(),
        webhookSecret: getStripeLiveWebhookSecret(),
      },
    ].filter(
      (candidate): candidate is {
        livemode: boolean;
        stripeKey: string;
        webhookSecret: string;
      } => Boolean(candidate.stripeKey && candidate.webhookSecret),
    );

    if (credentialCandidates.length === 0) {
      return NextResponse.json(
        { error: "Missing webhook environment variables" },
        { status: 500 }
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const webhookInventoryEngine = new InventoryEngine(
      storeId,
      new InventoryRepository(storeId, supabase),
      supabase,
    );

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing Stripe signature" },
        { status: 400 }
      );
    }

    let event: Stripe.Event | null = null;
    let eventStripeKey: string | null = null;
    let signatureError = "No configured signing secret accepted this event.";

    for (const candidate of credentialCandidates) {
      try {
        const candidateStripe = new Stripe(candidate.stripeKey);
        const candidateEvent = candidateStripe.webhooks.constructEvent(
          body,
          signature,
          candidate.webhookSecret,
        );
        if (candidateEvent.livemode !== candidate.livemode) {
          signatureError = "Webhook signing secret and event mode do not match.";
          continue;
        }
        event = candidateEvent;
        eventStripeKey = candidate.stripeKey;
        break;
      } catch (error: any) {
        signatureError = error.message || signatureError;
      }
    }

    if (!event || !eventStripeKey) {
      return NextResponse.json(
        { error: `Webhook signature failed: ${signatureError}` },
        { status: 400 }
      );
    }
    const stripe = new Stripe(eventStripeKey);

    const claim = await claimStripeWebhookEvent({
      supabase,
      storeId,
      event,
      payloadSha256: stripeWebhookPayloadHash(body),
      endpointPath: new URL(req.url).pathname,
    });

    if (!claim.claimed) {
      return NextResponse.json({
        received: true,
        duplicate: true,
        eventStatus: claim.eventStatus,
        attemptCount: claim.attemptCount,
      });
    }

    journal = {
      supabase,
      webhookEventId: claim.webhookEventId,
    };

    const simulationRunId = await stripePaymentSimulationRunId({
      stripe,
      event,
    });
    if (simulationRunId) {
      await finishStripeWebhookEvent({
        ...journal,
        status: "ignored",
        metadata: {
          outcome: "stripe_test_payment_simulation",
          simulation_run_id: simulationRunId,
        },
      });
      return NextResponse.json({ received: true, simulation: true });
    }

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;

      await updateSellerPayoutAccountFromStripe({
        supabase,
        account,
        storeId,
      });

      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "seller_payout_account_updated" },
      });

      return NextResponse.json({ received: true });
    }

    if (REFUND_EVENT_TYPES.has(event.type)) {
      const result = await processStripeRefundEvent({
        supabase,
        storeId,
        event,
        refund: event.data.object as Stripe.Refund,
      });

      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: {
          outcome: result.outcome,
          order_id: result.orderId,
          provider_object_id: result.providerObjectId,
          adjustment_count: result.adjustmentCount,
          held_seller_rows: result.heldSellerRows,
        },
      });

      return NextResponse.json({ received: true });
    }

    if (DISPUTE_EVENT_TYPES.has(event.type)) {
      const dispute = event.data.object as Stripe.Dispute;
      const result = await processStripeDisputeEvent({
        supabase,
        storeId,
        event,
        dispute,
      });
      const evidence = result.reviewCaseId
        ? await prepareStripeDisputeEvidence({
            supabase,
            stripe,
            storeId,
            caseId: result.reviewCaseId,
            dispute,
            stripeEventId: event.id,
            stageOnStripe: event.type === "charge.dispute.created",
          })
        : null;

      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: {
          outcome: result.outcome,
          order_id: result.orderId,
          provider_object_id: result.providerObjectId,
          adjustment_count: result.adjustmentCount,
          held_seller_rows: result.heldSellerRows,
          review_case_id: result.reviewCaseId,
          evidence_packet_id: evidence?.packetId || null,
          evidence_status: evidence?.status || null,
        },
      });

      return NextResponse.json({ received: true });
    }

    if (event.type !== "checkout.session.completed") {
      await finishStripeWebhookEvent({
        ...journal,
        status: "ignored",
        metadata: { outcome: "event_type_not_required" },
      });

      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata || {};

    if (metadata.type === "account_card_verification_setup") {
      const accountId = metadata.account_id;
      const setupIntentId =
        typeof session.setup_intent === "string" ? session.setup_intent : null;
      const setupIntent = setupIntentId
        ? await stripe.setupIntents.retrieve(setupIntentId)
        : null;
      const paymentMethodId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : null;
      const paymentMethod = paymentMethodId
        ? await stripe.paymentMethods.retrieve(paymentMethodId)
        : null;
      const cardEvidence = evaluateAccountCardVerification(paymentMethod);
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : typeof paymentMethod?.customer === "string"
            ? paymentMethod.customer
            : null;

      if (!accountId || !paymentMethodId) {
        throw new Error(
          "Account card verification metadata is incomplete",
        );
      }

      const verifiedAt = new Date().toISOString();
      const accountStatus = cardEvidence.allowed
        ? "active"
        : "payment_verification_required";

      await supabase
        .from("account_profiles")
        .update({
          account_status: accountStatus,
          card_verified: cardEvidence.allowed,
          card_verified_at: cardEvidence.allowed ? verifiedAt : null,
          stripe_customer_id: customerId,
          stripe_setup_intent_id: setupIntentId,
          stripe_payment_method_id: paymentMethodId,
          card_brand: cardEvidence.cardBrand,
          card_last4: cardEvidence.cardLast4,
          card_exp_month: cardEvidence.cardExpMonth,
          card_exp_year: cardEvidence.cardExpYear,
          card_funding: cardEvidence.cardFunding,
          billing_name: cardEvidence.billingName,
          billing_line1: cardEvidence.billingLine1,
          billing_line2: cardEvidence.billingLine2,
          billing_city: cardEvidence.billingCity,
          billing_state: cardEvidence.billingState,
          billing_country: cardEvidence.billingCountry,
          billing_postal_code: cardEvidence.billingPostalCode,
          card_verification_failure_reason: cardEvidence.failureReason,
          card_verification_checked_at: verifiedAt,
          updated_at: verifiedAt,
        })
        .eq("id", accountId);

      await supabase
        .from("account_store_memberships")
        .update({
          status: accountStatus,
          updated_at: verifiedAt,
        })
        .eq("account_id", accountId)
        .eq("store_id", storeId)
        .eq("role", "buyer");

      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "account_card_verification_updated" },
      });

      return NextResponse.json({ received: true });
    }

    if (metadata.type === "collector_binding_offer_setup") {
      const bindingOfferId = metadata.binding_offer_id;
      const conversationId = metadata.conversation_id;
      const setupIntentId =
        typeof session.setup_intent === "string" ? session.setup_intent : null;
      const setupIntent = setupIntentId
        ? await stripe.setupIntents.retrieve(setupIntentId)
        : null;
      const paymentMethodId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : null;
      const customerId =
        typeof session.customer === "string" ? session.customer : null;

      if (bindingOfferId) {
        await supabase
          .from("account_binding_offers")
          .update({
            status: "submitted",
            payment_requirement: "payment_method_on_file",
            stripe_customer_id: customerId,
            stripe_setup_intent_id: setupIntentId,
            stripe_payment_method_id: paymentMethodId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bindingOfferId)
          .eq("store_id", storeId);
      }

      if (conversationId) {
        await supabase.from("account_conversation_messages").insert({
          conversation_id: conversationId,
          store_id: storeId,
          sender_account_id: metadata.buyer_account_id,
          message_type: "system",
          body:
            "Payment method confirmed. The binding offer has been submitted for seller review.",
          metadata: {
            binding_offer_id: bindingOfferId,
            stripe_setup_intent_id: setupIntentId,
          },
        });

        await supabase
          .from("account_conversations")
          .update({
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId)
            .eq("store_id", storeId);
      }

      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "binding_offer_payment_method_confirmed" },
      });

      return NextResponse.json({ received: true });
    }

    const collectedInfo = session.collected_information as any;

    const customerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      "unknown";

    const customerName =
      session.customer_details?.name ||
      collectedInfo?.shipping_details?.name ||
      null;

    const shipping = collectedInfo?.shipping_details?.address;

    const shippingAddressLine1 = shipping?.line1 || null;
    const shippingAddressLine2 = shipping?.line2 || null;
    const shippingCity = shipping?.city || null;
    const shippingState = shipping?.state || null;
    const shippingPostalCode = shipping?.postal_code || null;
    const shippingCountry = shipping?.country || null;
    const shippingAllowed = isAllowedShippingCountry(shippingCountry);

    const total = Number(session.amount_total || 0) / 100;

    const shippingMethod = metadata.shipping_method || null;
    const shippingName = metadata.shipping_name || null;
    const shippingAmount = Number(metadata.shipping_amount || 0);
    const subtotal = Number(metadata.subtotal || total);
    const itemCount = Number(metadata.item_count || 0);
    const tosAccepted = metadata.tos_accepted === "true";
    const tosVersion = metadata.tos_version || null;
    const tosAcceptedAt = metadata.tos_accepted_at || null;
    const tosAcceptanceEventId = metadata.tos_acceptance_event_id || null;
    const tosIpAddress = metadata.tos_ip_address || null;
    const tosUserAgent = metadata.tos_user_agent || null;
    const tosIpRisk = metadata.tos_ip_risk || null;
    const tosIpBlockReason = metadata.tos_ip_block_reason || null;
    const accountId = metadata.account_id || null;
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

    const offerId = metadata.offer_id;
    const checkoutType = metadata.type || "cart";
    const isE2ETest =
      !event.livemode && metadata.tcos_e2e_checkout === "true";
    const testRunId = isE2ETest
      ? metadata.tcos_simulation_run_id || null
      : null;

    let rawCart: unknown = parseCartMetadata(metadata.cart);

    if (
      Array.isArray(rawCart) &&
      rawCart.length === 0 &&
      checkoutType === "accepted_offer"
    ) {
      const productId = Number(metadata.product_id);

      if (productId) {
        rawCart = [{ id: productId, quantity: 1 }];
      }
    }

    const cart = webhookInventoryEngine.normalizeCartItems(rawCart);
    const inventoryItems = await webhookInventoryEngine.requireAvailableCartItems(cart);
    const normalizedItemCount = cart.reduce(
      (total, cartItem) => total + cartItem.quantity,
      0
    );

    const { data: existingOrder, error: existingOrderError } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_session_id", session.id)
      .eq("store_id", storeId)
      .maybeSingle();

    if (existingOrderError) {
      console.error("Existing order lookup failed:", existingOrderError.message);
    }

    let orderId: number;

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
      shipping_address_line1: shippingAddressLine1,
      shipping_address_line2: shippingAddressLine2,
      shipping_city: shippingCity,
      shipping_state: shippingState,
      shipping_postal_code: shippingPostalCode,
      shipping_country: shippingCountry,
      contains_seller_items: false,
      seller_item_count: 0,
      store_item_count: 0,
      is_test: isE2ETest,
      test_run_id: testRunId,
    };

    const orderPayloadWithTerms = {
      ...orderPayload,
      tos_accepted: tosAccepted,
      tos_version: tosVersion,
      tos_accepted_at: tosAcceptedAt,
      tos_acceptance_event_id: tosAcceptanceEventId,
      tos_ip_address: tosIpAddress,
      tos_user_agent: tosUserAgent,
      tos_ip_risk: tosIpRisk,
      tos_ip_block_reason: tosIpBlockReason,
    };

    if (existingOrder) {
      orderId = existingOrder.id;

      const { error: updateError } = await supabase
        .from("orders")
        .update(orderPayloadWithTerms)
        .eq("id", orderId);

      if (updateError) {
        console.error("Order update failed:", updateError.message);
      }
    } else {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          ...orderPayloadWithTerms,
          stripe_session_id: session.id,
        })
        .select("id")
        .single();

      if (orderError || !order) {
        console.error("Order insert failed:", orderError?.message);
        throw orderError || new Error("Order insert failed");
      }

      orderId = order.id;
    }

    const { data: existingItems } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", orderId)
      .eq("store_id", storeId)
      .limit(1);

    let sellerItemCount = 0;
    let storeItemCount = 0;

    for (const cartItem of cart) {
      const product = inventoryItems.find(
        (item) => item.legacyProductId === cartItem.id
      );

      if (!product) continue;

      if (product.sellerAccountId) {
        sellerItemCount += cartItem.quantity;
      } else {
        storeItemCount += cartItem.quantity;
      }
    }

    if (!existingItems || existingItems.length === 0) {
      for (const cartItem of cart) {
        const product = inventoryItems.find(
          (item) => item.legacyProductId === cartItem.id
        );

        if (!product) {
          console.error(
            "Product lookup failed:",
            cartItem.id
          );
          continue;
        }

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

        if (itemError) {
          console.error("Order item insert failed:", itemError.message);
          continue;
        }

        let mutation;

        try {
          mutation = await webhookInventoryEngine.decrementAfterSale({
            legacyProductId: product.legacyProductId,
            quantity: cartItem.quantity,
            source: "stripe-webhook",
          });
        } catch (inventoryError: any) {
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

        if (!mutation) {
          console.error(
            "Product quantity update failed:",
            product.legacyProductId
          );
          continue;
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
    }

    await supabase
      .from("orders")
      .update({
        contains_seller_items: sellerItemCount > 0,
        seller_item_count: sellerItemCount,
        store_item_count: storeItemCount,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    const { data: ledgerOrderItems } = await supabase
      .from("order_items")
      .select("id,product_id,seller_account_id,title,price,quantity")
      .eq("order_id", orderId)
      .eq("store_id", storeId);

    if (ledgerOrderItems && ledgerOrderItems.length > 0) {
      try {
        const storeSettings = await getStoreSettings(supabase, storeId);

        await createPlatformFeeLedgerForOrder({
          supabase,
          storeId,
          orderId,
          orderItems: ledgerOrderItems,
          shippingAmount,
          platformFeeRate: storeSettings.sellerCommissionRate,
          stripeSession: session,
        });

        await createSellerPayoutLedgerForOrder({
          supabase,
          storeId,
          orderId,
          orderItems: ledgerOrderItems,
          shippingAmount,
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
      await supabase
        .from("offers")
        .update({
          status: "paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", offerId)
        .eq("store_id", storeId);
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

    await finishStripeWebhookEvent({
      ...journal,
      status: "processed",
      metadata: {
        outcome: "checkout_order_processed",
        order_id: orderId,
      },
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    if (journal) {
      try {
        await failStripeWebhookEvent({
          ...journal,
          error,
        });
      } catch {
        console.error("Stripe webhook failure could not be journaled");
      }
    }

    console.error("Webhook failed:", error.message);
    return NextResponse.json(
      { error: error.message || "Webhook failed" },
      { status: 500 }
    );
  }
}
