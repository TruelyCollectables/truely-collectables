import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStripeLiveSecretKey,
  getStripeTestSecretKey,
} from "./stripe-credentials";

export type PostPurchaseState =
  | "confirmed"
  | "processing"
  | "incomplete"
  | "unverified";

export type PostPurchaseOrderSummary = {
  id: number;
  createdAt: string | null;
  total: number;
  status: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  itemCount: number;
  trackingNumber: string | null;
  carrier: string | null;
};

export type PostPurchaseStatus = {
  state: PostPurchaseState;
  sessionId: string | null;
  metadata: Record<string, string>;
  purchaseType: string;
  accountLinked: boolean;
  stripeAmountTotal: number | null;
  order: PostPurchaseOrderSummary | null;
  detail: string;
};

type CheckoutSessionProof = Pick<
  Stripe.Checkout.Session,
  "mode" | "status" | "payment_status" | "metadata"
>;

function configuredStripeKeys() {
  return Array.from(
    new Set(
      [getStripeLiveSecretKey(), getStripeTestSecretKey()].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

async function retrieveCheckoutSession(sessionId: string) {
  for (const stripeKey of configuredStripeKeys()) {
    try {
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return session;
    } catch {
      // The session may belong to the other configured Stripe mode.
    }
  }

  return null;
}

function normalizedMetadata(
  metadata: Stripe.Metadata | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata || {}).map(([key, value]) => [key, String(value)]),
  );
}

export function belongsToActiveStorePayment(
  session: CheckoutSessionProof,
  storeId: string,
) {
  return session.mode === "payment" && session.metadata?.store_id === storeId;
}

export function isCompletedPaidCheckout(session: CheckoutSessionProof) {
  return session.status === "complete" && session.payment_status === "paid";
}

export async function resolvePostPurchaseStatus(params: {
  sessionId?: string | null;
  requestedType?: string | null;
  storeId: string;
  supabase: SupabaseClient;
}): Promise<PostPurchaseStatus> {
  const sessionId = String(params.sessionId || "").trim() || null;
  const requestedType = String(params.requestedType || "").trim();

  if (!sessionId) {
    return {
      state: "unverified",
      sessionId: null,
      metadata: {},
      purchaseType: requestedType || "cart",
      accountLinked: false,
      stripeAmountTotal: null,
      order: null,
      detail:
        "A Stripe Checkout Session ID was not provided, so payment cannot be verified.",
    };
  }

  if (configuredStripeKeys().length === 0) {
    return {
      state: "unverified",
      sessionId,
      metadata: {},
      purchaseType: requestedType || "cart",
      accountLinked: false,
      stripeAmountTotal: null,
      order: null,
      detail: "Stripe payment verification is temporarily unavailable.",
    };
  }

  const session = await retrieveCheckoutSession(sessionId);

  if (!session) {
    return {
      state: "unverified",
      sessionId,
      metadata: {},
      purchaseType: requestedType || "cart",
      accountLinked: false,
      stripeAmountTotal: null,
      order: null,
      detail: "This Stripe Checkout Session could not be verified.",
    };
  }

  const metadata = normalizedMetadata(session.metadata);
  const purchaseType = metadata.type || requestedType || "cart";
  const accountLinked = Boolean(metadata.account_id);
  const stripeAmountTotal =
    typeof session.amount_total === "number" ? session.amount_total / 100 : null;

  if (!belongsToActiveStorePayment(session, params.storeId)) {
    return {
      state: "unverified",
      sessionId,
      metadata: {},
      purchaseType,
      accountLinked: false,
      stripeAmountTotal: null,
      order: null,
      detail: "This checkout does not belong to the active store payment flow.",
    };
  }

  if (!isCompletedPaidCheckout(session)) {
    return {
      state: "incomplete",
      sessionId,
      metadata,
      purchaseType,
      accountLinked,
      stripeAmountTotal,
      order: null,
      detail:
        session.status === "open"
          ? "Checkout is still open and payment has not been completed."
          : "Stripe does not show a completed paid checkout for this session.",
    };
  }

  const orderResult = await params.supabase
    .from("orders")
    .select(
      "id,created_at,total,status,payment_status,fulfillment_status,item_count,tracking_number,carrier",
    )
    .eq("store_id", params.storeId)
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (orderResult.error || !orderResult.data) {
    return {
      state: "processing",
      sessionId,
      metadata,
      purchaseType,
      accountLinked,
      stripeAmountTotal,
      order: null,
      detail:
        "Stripe confirms payment. The signed webhook is still finalizing the order record and inventory update.",
    };
  }

  return {
    state: "confirmed",
    sessionId,
    metadata,
    purchaseType,
    accountLinked,
    stripeAmountTotal,
    order: {
      id: Number(orderResult.data.id),
      createdAt: orderResult.data.created_at || null,
      total: Number(orderResult.data.total || 0),
      status: orderResult.data.status || null,
      paymentStatus: orderResult.data.payment_status || null,
      fulfillmentStatus: orderResult.data.fulfillment_status || null,
      itemCount: Number(orderResult.data.item_count || 0),
      trackingNumber: orderResult.data.tracking_number || null,
      carrier: orderResult.data.carrier || null,
    },
    detail:
      "Stripe payment and the webhook-created order record are both verified.",
  };
}
