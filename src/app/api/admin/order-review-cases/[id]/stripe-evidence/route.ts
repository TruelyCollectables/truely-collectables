import Stripe from "stripe";
import { getActiveStoreId } from "../../../../../../lib/stores";
import {
  prepareStripeDisputeEvidence,
  submitStripeDisputeEvidence,
} from "../../../../../../lib/stripe-dispute-evidence";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { getOperationalStripeSecretKey } from "../../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function stripeClient() {
  const key = getOperationalStripeSecretKey();
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const caseId = String(id || "").trim();
    const storeId = getActiveStoreId();
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: reviewCase, error } = await supabase
      .from("order_review_cases")
      .select("id,provider,provider_case_id")
      .eq("id", caseId)
      .eq("store_id", storeId)
      .single();
    if (error || !reviewCase?.provider_case_id || reviewCase.provider !== "stripe") {
      return Response.json(
        { error: error?.message || "This case is not linked to a Stripe dispute." },
        { status: 404 },
      );
    }

    const stripe = stripeClient();
    const dispute = await stripe.disputes.retrieve(
      String(reviewCase.provider_case_id),
    );
    const result = await prepareStripeDisputeEvidence({
      supabase,
      stripe,
      storeId,
      caseId,
      dispute,
      stageOnStripe: true,
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not stage Stripe dispute evidence." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json().catch(() => ({}));
    if (String(body.confirmation || "").trim() !== "SUBMIT TO STRIPE") {
      return Response.json(
        { error: "Type SUBMIT TO STRIPE to confirm final evidence submission." },
        { status: 400 },
      );
    }

    const { id } = await params;
    const result = await submitStripeDisputeEvidence({
      supabase: createSupabaseServerClient({ admin: true }),
      stripe: stripeClient(),
      storeId: getActiveStoreId(),
      caseId: String(id || "").trim(),
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not submit Stripe dispute evidence." },
      { status: 500 },
    );
  }
}
