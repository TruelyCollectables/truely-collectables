import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { InventoryEngine, InventoryRepository } from "../../../modules/inventory";
import { getActiveStoreId } from "../../../lib/stores";
import { updateSellerPayoutAccountFromStripe } from "../../../lib/seller-payouts";
import { evaluateAccountCardVerification } from "../../../lib/account-card-verification";
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
import { finalizeCheckoutOrder } from "../../../lib/checkout-order-finalization";

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

async function handleAccountCardVerification(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  storeId: string;
}) {
  const { supabase, stripe, session, storeId } = params;
  const metadata = session.metadata || {};
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
    throw new Error("Account card verification metadata is incomplete");
  }

  const verifiedAt = new Date().toISOString();
  const accountStatus = cardEvidence.allowed
    ? "active"
    : "payment_verification_required";
  const { error: profileError } = await supabase
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
  if (profileError) throw profileError;

  const { error: membershipError } = await supabase
    .from("account_store_memberships")
    .update({ status: accountStatus, updated_at: verifiedAt })
    .eq("account_id", accountId)
    .eq("store_id", storeId)
    .eq("role", "buyer");
  if (membershipError) throw membershipError;
}

async function handleBindingOfferSetup(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  storeId: string;
}) {
  const { supabase, stripe, session, storeId } = params;
  const metadata = session.metadata || {};
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
    const { error } = await supabase
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
    if (error) throw error;
  }

  if (conversationId) {
    const { error: messageError } = await supabase
      .from("account_conversation_messages")
      .insert({
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
    if (messageError) throw messageError;

    const { error: conversationError } = await supabase
      .from("account_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("store_id", storeId);
    if (conversationError) throw conversationError;
  }
}

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
        { status: 500 },
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
        { status: 400 },
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
        { status: 400 },
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

    journal = { supabase, webhookEventId: claim.webhookEventId };
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
      await updateSellerPayoutAccountFromStripe({
        supabase,
        account: event.data.object as Stripe.Account,
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
      await handleAccountCardVerification({
        supabase,
        stripe,
        session,
        storeId,
      });
      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "account_card_verification_updated" },
      });
      return NextResponse.json({ received: true });
    }

    if (metadata.type === "collector_binding_offer_setup") {
      await handleBindingOfferSetup({ supabase, stripe, session, storeId });
      await finishStripeWebhookEvent({
        ...journal,
        status: "processed",
        metadata: { outcome: "binding_offer_payment_method_confirmed" },
      });
      return NextResponse.json({ received: true });
    }

    const result = await finalizeCheckoutOrder({
      supabase,
      stripe,
      event,
      session,
      storeId,
      inventoryEngine: webhookInventoryEngine,
    });
    await finishStripeWebhookEvent({
      ...journal,
      status: "processed",
      metadata: {
        outcome: "checkout_order_processed",
        order_id: result.orderId,
      },
    });
    return NextResponse.json({ received: true });
  } catch (error: any) {
    if (journal) {
      try {
        await failStripeWebhookEvent({ ...journal, error });
      } catch {
        console.error("Stripe webhook failure could not be journaled");
      }
    }

    console.error("Webhook failed:", error.message);
    return NextResponse.json(
      { error: error.message || "Webhook failed" },
      { status: 500 },
    );
  }
}
