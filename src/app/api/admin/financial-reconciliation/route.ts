import Stripe from "stripe";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  previousUtcDayWindow,
  reconcileStripeDaily,
} from "../../../../lib/stripe-reconciliation";
import {
  cleanFinancialReconciliationNote,
  financialReconciliationDecisionError,
  parseFinancialReconciliationDecisionStatus,
} from "../../../../lib/admin-financial-reconciliation";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getOperationalStripeSecretKey } from "../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const stripeKey = getOperationalStripeSecretKey();
    if (!stripeKey) {
      return Response.json({ error: "Stripe is not configured." }, { status: 503 });
    }

    const window = previousUtcDayWindow();
    const result = await reconcileStripeDaily({
      supabase: createSupabaseServerClient({ admin: true }),
      stripe: new Stripe(stripeKey),
      storeId: getActiveStoreId(),
      source: "admin_manual",
      windowStart: window.start,
      windowEnd: window.end,
    });
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not run Stripe reconciliation." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const itemId = String(body.itemId || "").trim();
    const status = parseFinancialReconciliationDecisionStatus(body.status);
    const resolutionNote = cleanFinancialReconciliationNote(body.resolutionNote);
    const decisionError = financialReconciliationDecisionError({
      itemId,
      status,
      resolutionNote,
    });

    if (decisionError) {
      return Response.json(
        { error: decisionError },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("stripe_reconciliation_items")
      .update({
        item_status: status!,
        resolution_note: resolutionNote!,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .eq("store_id", getActiveStoreId())
      .eq("item_status", "open")
      .select("id,item_status")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return Response.json({ error: "Open reconciliation item not found." }, { status: 404 });
    }

    return Response.json({ success: true, item: data });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not resolve reconciliation item." },
      { status: 500 },
    );
  }
}
