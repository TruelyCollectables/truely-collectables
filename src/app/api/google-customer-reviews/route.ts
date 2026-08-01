import { NextResponse } from "next/server";
import Stripe from "stripe";
import { buildGoogleCustomerReviewsOptInConfig } from "../../../lib/google-customer-reviews";
import {
  belongsToActiveStorePayment,
  isCompletedPaidCheckout,
} from "../../../lib/post-purchase-status";
import { getStripeLiveSecretKey } from "../../../lib/stripe-credentials";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams
    .get("session_id")
    ?.trim();

  if (
    !sessionId ||
    !sessionId.startsWith("cs_live_") ||
    sessionId.length > 255
  ) {
    return noStoreJson({ error: "A valid live Checkout Session is required." }, 400);
  }

  const stripeKey = getStripeLiveSecretKey();
  if (!stripeKey) {
    return noStoreJson(
      { error: "Live checkout verification is temporarily unavailable." },
      503,
    );
  }

  let session: Stripe.Checkout.Session;
  try {
    const stripe = new Stripe(stripeKey);
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return noStoreJson({ error: "Checkout Session not found." }, 404);
  }

  const storeId = getActiveStoreId();
  if (
    !session.livemode ||
    !belongsToActiveStorePayment(session, storeId) ||
    !isCompletedPaidCheckout(session)
  ) {
    return noStoreJson(
      { error: "This is not a completed live checkout for this store." },
      404,
    );
  }

  const collectedInformation = session.collected_information as any;
  const legacyShippingDetails = (session as any).shipping_details;
  const email = session.customer_details?.email || session.customer_email;
  const deliveryCountry =
    collectedInformation?.shipping_details?.address?.country ||
    legacyShippingDetails?.address?.country ||
    session.customer_details?.address?.country;
  const config = buildGoogleCustomerReviewsOptInConfig({
    orderId: session.id,
    email,
    deliveryCountry,
    orderedAt: new Date(session.created * 1000).toISOString(),
    shippingMethod: session.metadata?.shipping_method,
  });

  if (!config) {
    return noStoreJson(
      {
        error:
          "The paid checkout is missing an email address or delivery country required by Google Customer Reviews.",
      },
      422,
    );
  }

  return noStoreJson({ config });
}
