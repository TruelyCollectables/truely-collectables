import { getClientIdentity } from "../../../../../../lib/client-identity";
import {
  getShippingCoverage,
  isShippingMethod,
  type ShippingMethod,
} from "../../../../../../lib/shipping";
import { getShippingProviderReadiness } from "../../../../../../lib/shipping-provider-readiness";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: number;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | string | null;
  subtotal: number | string | null;
  item_count: number | null;
  tracking_number: string | null;
  carrier: string | null;
};

function safeShippingMethod(value: string | null): ShippingMethod {
  return isShippingMethod(value) ? value : "GROUND_ADVANTAGE";
}

function providerForMethod(method: ShippingMethod) {
  if (method === "STANDARD_ENVELOPE") {
    return "pending_imb_envelope_provider";
  }

  return "pending_parcel_label_provider";
}

function serviceForMethod(method: ShippingMethod) {
  if (method === "STANDARD_ENVELOPE") return "TCOS Standard Envelope";
  if (method === "PRIORITY_MAIL") return "USPS Priority Mail";
  return "USPS Ground Advantage";
}

function carrierForMethod(method: ShippingMethod) {
  return method === "STANDARD_ENVELOPE" ? "USPS IMb" : "USPS";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orderId = Number(id);

    if (!orderId) {
      return Response.json({ error: "Missing order id." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const providerReadiness = getShippingProviderReadiness();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,shipping_method,shipping_name,shipping_amount,subtotal,item_count,tracking_number,carrier",
      )
      .eq("id", orderId)
      .eq("store_id", storeId)
      .single();

    if (orderError || !order) {
      return Response.json(
        { error: orderError?.message || "Order not found." },
        { status: 404 },
      );
    }

    const typedOrder = order as OrderRow;
    const resolvedMethod = safeShippingMethod(typedOrder.shipping_method);
    const coverage = getShippingCoverage({
      method: resolvedMethod,
      subtotal: Number(typedOrder.subtotal || 0),
    });

    const { data: existingLabel, error: existingError } = await supabase
      .from("order_shipping_labels")
      .select("id,label_status")
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .not("label_status", "in", "(voided,failed)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return Response.json({ error: existingError.message }, { status: 500 });
    }

    if (existingLabel?.id) {
      return Response.json({
        success: true,
        reused: true,
        labelId: existingLabel.id,
        labelStatus: existingLabel.label_status,
        providerReadiness,
      });
    }

    const now = new Date().toISOString();
    const { data: label, error: insertError } = await supabase
      .from("order_shipping_labels")
      .insert({
        store_id: storeId,
        order_id: orderId,
        provider: providerForMethod(resolvedMethod),
        provider_service: serviceForMethod(resolvedMethod),
        service_level: resolvedMethod,
        carrier: typedOrder.carrier || carrierForMethod(resolvedMethod),
        tracking_number: typedOrder.tracking_number || null,
        postage_amount: Number(typedOrder.shipping_amount || 0),
        requested_shipping_method: typedOrder.shipping_method,
        resolved_shipping_method: resolvedMethod,
        coverage_provider: coverage.provider,
        coverage_required: coverage.required,
        coverage_status: coverage.status,
        coverage_amount: coverage.coveredAmount,
        metadata: {
          source: "admin_order_detail",
          shipping_name: typedOrder.shipping_name,
          item_count: typedOrder.item_count,
          coverage_type: coverage.coverageType,
          coverage_detail: coverage.detail,
          planned_at: now,
          planned_by_identity: identity,
          provider_purchase_required: true,
          provider_readiness_at_planning: providerReadiness,
        },
      })
      .select("id,label_status,coverage_status")
      .single();

    if (insertError || !label) {
      return Response.json(
        { error: insertError?.message || "Could not create shipping label record." },
        { status: 500 },
      );
    }

    await supabase.from("order_shipping_tracking_events").insert({
      store_id: storeId,
      order_id: orderId,
      shipping_label_id: label.id,
      provider: "manual",
      carrier: typedOrder.carrier || carrierForMethod(resolvedMethod),
      tracking_number: typedOrder.tracking_number || null,
      event_type: "label_record_planned",
      event_status: "planned",
      message:
        "Internal shipping label and seller coverage record prepared. Provider purchase is still required.",
      occurred_at: now,
      raw_payload: {
        shipping_method: resolvedMethod,
        coverage_provider: coverage.provider,
        coverage_amount: coverage.coveredAmount,
      },
    });

    return Response.json({
      success: true,
      reused: false,
      labelId: label.id,
      labelStatus: label.label_status,
      coverageStatus: label.coverage_status,
      providerReadiness,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not prepare shipping label record." },
      { status: 500 },
    );
  }
}
