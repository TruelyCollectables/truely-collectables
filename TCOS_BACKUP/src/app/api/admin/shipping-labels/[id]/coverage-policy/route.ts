import { getClientIdentity } from "../../../../../../lib/client-identity";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  coverage_provider: string | null;
  coverage_amount: number | string | null;
  coverage_policy_id: string | null;
  metadata: Record<string, unknown> | null;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 1000) : null;
}

function cleanMoney(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return Number(amount.toFixed(2));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const labelId = String(id || "").trim();

    if (!labelId) {
      return Response.json(
        { error: "Missing shipping label id." },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const coveragePolicyId = cleanText(body.coveragePolicyId);
    const coverageProvider = cleanText(body.coverageProvider) || "Coverage";
    const coverageAmount = cleanMoney(body.coverageAmount);
    const note = cleanText(body.note);

    if (!coveragePolicyId) {
      return Response.json(
        { error: "Coverage policy ID is required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);

    const { data: labelData, error: labelError } = await supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,provider,carrier,tracking_number,coverage_provider,coverage_amount,coverage_policy_id,metadata",
      )
      .eq("store_id", storeId)
      .eq("id", labelId)
      .maybeSingle();

    if (labelError) throw labelError;

    const label = (labelData || null) as ShippingLabelRow | null;

    if (!label?.id) {
      return Response.json(
        { error: "Shipping label was not found." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const nextCoverageAmount =
      coverageAmount ?? Number(label.coverage_amount || 0);
    const { error: updateError } = await supabase
      .from("order_shipping_labels")
      .update({
        coverage_provider: coverageProvider,
        coverage_policy_id: coveragePolicyId,
        coverage_amount: nextCoverageAmount,
        coverage_status: "covered",
        updated_at: now,
        metadata: {
          ...(label.metadata || {}),
          latest_coverage_policy_record: {
            recorded_at: now,
            recorded_by_identity: identity,
            coverage_provider: coverageProvider,
            coverage_policy_id: coveragePolicyId,
            coverage_amount: nextCoverageAmount,
            previous_coverage_policy_id: label.coverage_policy_id,
            note,
          },
        },
      })
      .eq("store_id", storeId)
      .eq("id", label.id);

    if (updateError) throw updateError;

    const { error: eventError } = await supabase
      .from("order_shipping_tracking_events")
      .insert({
        store_id: storeId,
        order_id: label.order_id,
        shipping_label_id: label.id,
        provider: coverageProvider,
        carrier: label.carrier,
        tracking_number: label.tracking_number,
        event_type: "coverage_policy_recorded",
        event_status: "covered",
        message: "Coverage policy ID recorded for this shipping label.",
        occurred_at: now,
        raw_payload: {
          recorded_by_identity: identity,
          coverage_provider: coverageProvider,
          coverage_policy_id: coveragePolicyId,
          coverage_amount: nextCoverageAmount,
          previous_coverage_policy_id: label.coverage_policy_id,
          note,
        },
      });

    if (eventError) throw eventError;

    return Response.json({
      success: true,
      labelId: label.id,
      coverageStatus: "covered",
      coveragePolicyId,
      message: "Coverage policy was recorded.",
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not record Coverage policy." },
      { status: 500 },
    );
  }
}
