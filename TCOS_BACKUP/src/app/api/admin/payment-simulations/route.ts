import Stripe from "stripe";
import { runPaymentSimulationSuite } from "../../../../lib/payment-simulations";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "deterministic");
    if (!(["deterministic", "stripe_test"] as string[]).includes(mode)) {
      return Response.json({ error: "Invalid simulation mode." }, { status: 400 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    if (mode === "stripe_test" && !stripeKey.startsWith("sk_test_")) {
      return Response.json(
        {
          error:
            "Stripe sandbox simulations are locked unless STRIPE_SECRET_KEY is an sk_test_ key.",
        },
        { status: 409 },
      );
    }

    const result = await runPaymentSimulationSuite({
      supabase: createSupabaseServerClient({ admin: true }),
      stripe: mode === "stripe_test" ? new Stripe(stripeKey) : undefined,
      webhookSecret:
        mode === "stripe_test" ? process.env.STRIPE_WEBHOOK_SECRET : undefined,
      webhookUrl:
        mode === "stripe_test"
          ? `${new URL(request.url).origin}/api/webhook`
          : undefined,
      storeId: getActiveStoreId(),
      mode: mode as "deterministic" | "stripe_test",
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Payment simulation suite failed." },
      { status: 500 },
    );
  }
}
