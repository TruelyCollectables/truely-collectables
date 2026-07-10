import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  previousUtcDayWindow,
  reconcileStripeDaily,
} from "../../../../lib/stripe-reconciliation";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!secret || secret.length < 16 || !stripeKey) {
    return Response.json(
      { error: "Scheduled Stripe reconciliation is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const window = previousUtcDayWindow();
    const result = await reconcileStripeDaily({
      supabase: createSupabaseServerClient({ admin: true }),
      stripe: new Stripe(stripeKey),
      storeId: getActiveStoreId(),
      source: "scheduled_cron",
      windowStart: window.start,
      windowEnd: window.end,
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Scheduled Stripe reconciliation failed." },
      { status: 500 },
    );
  }
}
