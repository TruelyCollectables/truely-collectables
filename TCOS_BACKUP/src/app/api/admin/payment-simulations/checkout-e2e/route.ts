import Stripe from "stripe";
import { runCheckoutE2ESimulation } from "../../../../../lib/checkout-e2e-simulation";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  getStripeTestSecretKey,
  getStripeTestWebhookSecret,
} from "../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const stripeKey = getStripeTestSecretKey() || "";
    const webhookSecret = getStripeTestWebhookSecret() || "";
    if (!stripeKey.startsWith("sk_test_")) {
      return Response.json(
        { error: "Checkout E2E is locked unless Stripe uses an sk_test_ key." },
        { status: 409 },
      );
    }
    if (!webhookSecret.startsWith("whsec_")) {
      return Response.json(
        { error: "Checkout E2E requires the production webhook signing secret." },
        { status: 503 },
      );
    }

    const result = await runCheckoutE2ESimulation({
      supabase: createSupabaseServerClient({ admin: true }),
      stripe: new Stripe(stripeKey),
      storeId: getActiveStoreId(),
      appOrigin: new URL(request.url).origin,
      webhookSecret,
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Checkout E2E simulation failed." },
      { status: 500 },
    );
  }
}
