import { getClientIdentity } from "../../../../../../lib/client-identity";
import { getLiveShippingRuntimeGate } from "../../../../../../lib/live-shipping-launch";
import {
  getShippingCoverage,
  isShippingMethod,
  resolveShippingMethod,
  type ShippingMethod,
} from "../../../../../../lib/shipping";
import {
  getShippingProviderReadiness,
  shippingPurchaseBlockers,
} from "../../../../../../lib/shipping-provider-readiness";
import {
  getShippingProviderAdapterProfile,
  purchaseShippingLabel,
} from "../../../../../../lib/shipping-provider-adapter";
import { isDryRunShippingReference } from "../../../../../../lib/shipping-dry-run";
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

type ShippingLabelRow = {
  id: string;
  label_status: string | null;
  coverage_status: string | null;
  resolved_shipping_method: string | null;
  metadata?: Record<string, unknown> | null;
};

function safeShippingMethod(value: string | null): ShippingMethod {
  return isShippingMethod(value) ? value : "GROUND_ADVANTAGE";
}

function carrierForMethod(method: ShippingMethod) {
  return method === "STANDARD_ENVELOPE" ? "USPS IMb" : "USPS";
}

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

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data: order, error } = await params.supabase
    .from("orders")
    .select(
      "id,shipping_method,shipping_name,shipping_amount,subtotal,item_count,tracking_number,carrier",
    )
    .eq("id", params.orderId)
    .eq("store_id", params.storeId)
    .single();

  if (error || !order) {
    throw new Response(
      JSON.stringify({ error: error?.message || "Order not found." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return order as OrderRow;
}

async function activeLabelForOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_labels")
    .select("id,label_status,coverage_status,resolved_shipping_method,metadata")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .not("label_status", "in", "(voided,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return (data || null) as ShippingLabelRow | null;
}

async function createPlannedLabel(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
  identity: Awaited<ReturnType<typeof getClientIdentity>>;
  providerReadiness: ReturnType<typeof getShippingProviderReadiness>;
  order: OrderRow;
}) {
  const requestedMethod = safeShippingMethod(params.order.shipping_method);
  const shippingPolicy = resolveShippingMethod({
    requestedMethod,
    itemCount: Number(params.order.item_count || 1),
    subtotal: Number(params.order.subtotal || 0),
  });
  const resolvedMethod = shippingPolicy.method;
  const adapterProfile = getShippingProviderAdapterProfile(resolvedMethod);
  const coverage = getShippingCoverage({
    method: resolvedMethod,
    subtotal: Number(params.order.subtotal || 0),
  });
  const now = new Date().toISOString();
  const { data: label, error } = await params.supabase
    .from("order_shipping_labels")
    .insert({
      store_id: params.storeId,
      order_id: params.orderId,
      provider: adapterProfile.provider,
      provider_service: adapterProfile.providerService,
      service_level: resolvedMethod,
      carrier: params.order.carrier || adapterProfile.carrier,
      tracking_number: params.order.tracking_number || null,
      postage_amount: Number(params.order.shipping_amount || 0),
      requested_shipping_method: requestedMethod,
      resolved_shipping_method: resolvedMethod,
      coverage_provider: coverage.provider,
      coverage_required: coverage.required,
      coverage_status: coverage.status,
      coverage_amount: coverage.coveredAmount,
      metadata: {
        source: "admin_order_detail",
        shipping_name: params.order.shipping_name,
        item_count: params.order.item_count,
        coverage_type: coverage.coverageType,
        coverage_detail: coverage.detail,
        requested_shipping_method: requestedMethod,
        resolved_shipping_method: resolvedMethod,
        shipping_policy_reason: shippingPolicy.reason,
        standard_envelope_eligible: shippingPolicy.standardEnvelope.eligible,
        standard_envelope_estimated_oz:
          shippingPolicy.standardEnvelope.estimatedOunces,
        standard_envelope_reason: shippingPolicy.standardEnvelope.reason,
        planned_at: now,
        planned_by_identity: params.identity,
        provider_purchase_required: true,
        shipping_adapter_profile: adapterProfile,
        provider_readiness_at_planning: params.providerReadiness,
      },
    })
    .select("id,label_status,coverage_status,resolved_shipping_method,metadata")
    .single();

  if (error || !label) {
    throw error || new Error("Could not create shipping label record.");
  }

  await params.supabase.from("order_shipping_tracking_events").insert({
    store_id: params.storeId,
    order_id: params.orderId,
    shipping_label_id: label.id,
    provider: "manual",
    carrier: params.order.carrier || adapterProfile.carrier,
    tracking_number: params.order.tracking_number || null,
    event_type: "label_record_planned",
    event_status: "planned",
    message:
      "Internal shipping label and seller coverage record prepared. Provider purchase is still required.",
    occurred_at: now,
    raw_payload: {
      requested_shipping_method: requestedMethod,
      resolved_shipping_method: resolvedMethod,
      shipping_policy_reason: shippingPolicy.reason,
      standard_envelope_eligible: shippingPolicy.standardEnvelope.eligible,
      standard_envelope_estimated_oz:
        shippingPolicy.standardEnvelope.estimatedOunces,
      standard_envelope_reason: shippingPolicy.standardEnvelope.reason,
      coverage_provider: coverage.provider,
      coverage_amount: coverage.coveredAmount,
      shipping_adapter_profile: adapterProfile,
    },
  });

  return label as ShippingLabelRow;
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

    const typedOrder = await loadOrder({ supabase, storeId, orderId });
    const existingLabel = await activeLabelForOrder({ supabase, storeId, orderId });

    if (existingLabel?.id) {
      return Response.json({
        success: true,
        reused: true,
        labelId: existingLabel.id,
        labelStatus: existingLabel.label_status,
        providerReadiness,
      });
    }

    const label = await createPlannedLabel({
      supabase,
      storeId,
      orderId,
      identity,
      providerReadiness,
      order: typedOrder,
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
    if (error instanceof Response) return error;

    return Response.json(
      { error: error.message || "Could not prepare shipping label record." },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const body = await request.json().catch(() => ({}));
    const providerReadiness = getShippingProviderReadiness();
    const typedOrder = await loadOrder({ supabase, storeId, orderId });
    let label = await activeLabelForOrder({ supabase, storeId, orderId });

    if (!label && body.action === "record_manual_void") {
      return Response.json(
        {
          error:
            "No active shipping label record exists to void. Prepare or record a label first.",
        },
        { status: 409 },
      );
    }

    if (!label) {
      label = await createPlannedLabel({
        supabase,
        storeId,
        orderId,
        identity,
        providerReadiness,
        order: typedOrder,
      });
    }

    if (body.action === "record_manual_purchase") {
      const now = new Date().toISOString();
      const provider =
        cleanText(body.provider) ||
        getShippingProviderAdapterProfile(label.resolved_shipping_method).provider;
      const carrier =
        cleanText(body.carrier) ||
        typedOrder.carrier ||
        getShippingProviderAdapterProfile(label.resolved_shipping_method).carrier;
      const trackingNumber =
        cleanText(body.trackingNumber) || typedOrder.tracking_number || null;
      const postageAmount =
        cleanMoney(body.postageAmount) ??
        Number(typedOrder.shipping_amount || 0);
      const coverageProvider = cleanText(body.coverageProvider) || "Coverage";
      const coveragePolicyId = cleanText(body.coveragePolicyId);
      const coverageAmount = cleanMoney(body.coverageAmount);
      const labelUrl = cleanText(body.labelUrl);
      const labelPdfUrl = cleanText(body.labelPdfUrl);
      const providerLabelId = cleanText(body.providerLabelId);
      const providerShipmentId = cleanText(body.providerShipmentId);
      const note = cleanText(body.note);
      const labelStatus = labelPdfUrl || labelUrl ? "printed" : "purchased";
      const coverageStatus = coveragePolicyId ? "covered" : "purchase_pending";
      const dryRunFields = [
        ["provider", provider],
        ["carrier", carrier],
        ["trackingNumber", trackingNumber],
        ["providerLabelId", providerLabelId],
        ["providerShipmentId", providerShipmentId],
        ["coverageProvider", coverageProvider],
        ["coveragePolicyId", coveragePolicyId],
        ["labelUrl", labelUrl],
        ["labelPdfUrl", labelPdfUrl],
      ]
        .filter(([, value]) => isDryRunShippingReference(value))
        .map(([field]) => field);

      if (dryRunFields.length > 0) {
        return Response.json(
          {
            error:
              "Manual purchase records must use real external label and Coverage details, not TCOS dry-run references.",
            dryRunFields,
          },
          { status: 409 },
        );
      }

      const { error: labelUpdateError } = await supabase
        .from("order_shipping_labels")
        .update({
          provider,
          provider_label_id: providerLabelId,
          provider_shipment_id: providerShipmentId,
          carrier,
          tracking_number: trackingNumber,
          label_url: labelUrl,
          label_pdf_url: labelPdfUrl,
          postage_amount: postageAmount,
          label_status: labelStatus,
          coverage_provider: coverageProvider,
          coverage_status: coverageStatus,
          coverage_amount:
            coverageAmount ?? Number(typedOrder.subtotal || 0),
          coverage_policy_id: coveragePolicyId,
          purchased_at: now,
          printed_at: labelStatus === "printed" ? now : null,
          updated_at: now,
          metadata: {
            ...(label.metadata || {}),
            latest_purchase_attempt: {
              status: "manual_purchase_recorded",
              attempted_at: now,
              attempted_by_identity: identity,
              provider_readiness: providerReadiness,
              message:
                "Admin recorded a real external label/Coverage purchase. This supersedes any previous TCOS dry-run purchase attempt for fulfillment gating.",
            },
            latest_manual_purchase_record: {
              recorded_at: now,
              recorded_by_identity: identity,
              note,
              provider,
              carrier,
              tracking_number: trackingNumber,
              provider_label_id: providerLabelId,
              provider_shipment_id: providerShipmentId,
              coverage_policy_id: coveragePolicyId,
              label_status: labelStatus,
              coverage_status: coverageStatus,
            },
          },
        })
        .eq("id", label.id)
        .eq("store_id", storeId);

      if (labelUpdateError) throw labelUpdateError;

      if (trackingNumber || carrier) {
        const { error: orderUpdateError } = await supabase
          .from("orders")
          .update({
            carrier,
            tracking_number: trackingNumber,
            updated_at: now,
          })
          .eq("id", orderId)
          .eq("store_id", storeId);

        if (orderUpdateError) throw orderUpdateError;
      }

      await supabase.from("order_shipping_tracking_events").insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider,
        carrier,
        tracking_number: trackingNumber,
        event_type: "manual_label_purchase_recorded",
        event_status: labelStatus,
        message:
          "Admin recorded an externally purchased shipping label and Coverage policy details in TCOS.",
        occurred_at: now,
        raw_payload: {
          recorded_by_identity: identity,
          provider_label_id: providerLabelId,
          provider_shipment_id: providerShipmentId,
          label_url: labelUrl,
          label_pdf_url: labelPdfUrl,
          postage_amount: postageAmount,
          coverage_provider: coverageProvider,
          coverage_policy_id: coveragePolicyId,
          coverage_amount: coverageAmount,
          coverage_status: coverageStatus,
          note,
        },
      });

      return Response.json({
        success: true,
        labelId: label.id,
        labelStatus,
        coverageStatus,
        message:
          "Manual shipping label and Coverage policy details were recorded.",
      });
    }

    if (body.action === "record_manual_void") {
      const now = new Date().toISOString();
      const provider = cleanText(body.provider) || "manual";
      const carrier =
        cleanText(body.carrier) ||
        typedOrder.carrier ||
        carrierForMethod(safeShippingMethod(label.resolved_shipping_method));
      const trackingNumber =
        cleanText(body.trackingNumber) || typedOrder.tracking_number || null;
      const voidReference = cleanText(body.voidReference);
      const coverageCancellationReference = cleanText(
        body.coverageCancellationReference,
      );
      const note = cleanText(body.note);

      const { error: voidError } = await supabase
        .from("order_shipping_labels")
        .update({
          label_status: "voided",
          coverage_status: "failed",
          voided_at: now,
          updated_at: now,
          metadata: {
            ...(label.metadata || {}),
            latest_manual_void_record: {
              recorded_at: now,
              recorded_by_identity: identity,
              provider,
              carrier,
              tracking_number: trackingNumber,
              void_reference: voidReference,
              coverage_cancellation_reference: coverageCancellationReference,
              note,
              reminder:
                "This records an external provider void/cancel. TCOS did not submit a provider void request.",
            },
          },
        })
        .eq("id", label.id)
        .eq("store_id", storeId);

      if (voidError) throw voidError;

      await supabase.from("order_shipping_tracking_events").insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider,
        carrier,
        tracking_number: trackingNumber,
        event_type: "manual_label_void_recorded",
        event_status: "voided",
        message:
          "Admin recorded an external label void and Coverage cancellation status in TCOS. No provider void was submitted by TCOS.",
        occurred_at: now,
        raw_payload: {
          recorded_by_identity: identity,
          void_reference: voidReference,
          coverage_cancellation_reference: coverageCancellationReference,
          note,
        },
      });

      return Response.json({
        success: true,
        labelId: label.id,
        labelStatus: "voided",
        coverageStatus: "failed",
        message:
          "External label void/cancel was recorded. You can prepare a replacement label now.",
      });
    }

    const blockers = shippingPurchaseBlockers({
      method: label.resolved_shipping_method || typedOrder.shipping_method,
      readiness: providerReadiness,
    });
    const adapterProfile = getShippingProviderAdapterProfile(
      label.resolved_shipping_method || typedOrder.shipping_method,
    );
    const now = new Date().toISOString();
    const liveShippingGate = await getLiveShippingRuntimeGate({
      supabase,
      storeId,
    });

    if (!liveShippingGate.allowed) {
      await supabase.from("order_shipping_tracking_events").insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: "tcos",
        carrier: typedOrder.carrier || carrierForMethod(
          safeShippingMethod(label.resolved_shipping_method),
        ),
        tracking_number: typedOrder.tracking_number || null,
        event_type: "provider_purchase_blocked",
        event_status: "blocked",
        message: liveShippingGate.reason,
        occurred_at: now,
        raw_payload: {
          blocker_type: "live_shipping_runtime_gate",
          live_shipping_gate: liveShippingGate,
          shipping_adapter_profile: adapterProfile,
          attempted_by_identity: identity,
        },
      });

      await supabase
        .from("order_shipping_labels")
        .update({
          label_status: "purchase_pending",
          coverage_status:
            label.coverage_status === "covered"
              ? label.coverage_status
              : "purchase_pending",
          updated_at: now,
          metadata: {
            ...(label.metadata || {}),
            latest_purchase_attempt: {
              status: "blocked",
              attempted_at: now,
              attempted_by_identity: identity,
              blocker_type: "live_shipping_runtime_gate",
              live_shipping_gate: liveShippingGate,
              shipping_adapter_profile: adapterProfile,
            },
          },
        })
        .eq("id", label.id)
        .eq("store_id", storeId);

      return Response.json(
        {
          error:
            liveShippingGate.reason ||
            "Provider purchase is blocked by the live shipping launch gate.",
          labelId: label.id,
          liveShippingGate,
        },
        { status: 409 },
      );
    }

    if (blockers.length > 0) {
      await supabase.from("order_shipping_tracking_events").insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: "tcos",
        carrier: typedOrder.carrier || carrierForMethod(
          safeShippingMethod(label.resolved_shipping_method),
        ),
        tracking_number: typedOrder.tracking_number || null,
        event_type: "provider_purchase_blocked",
        event_status: "blocked",
        message:
          "Provider label/coverage purchase blocked because required provider credentials are missing.",
        occurred_at: now,
        raw_payload: {
          blockers,
          shipping_adapter_profile: adapterProfile,
          attempted_by_identity: identity,
        },
      });

      await supabase
        .from("order_shipping_labels")
        .update({
          label_status: "purchase_pending",
          coverage_status:
            label.coverage_status === "covered"
              ? label.coverage_status
              : "purchase_pending",
          updated_at: now,
          metadata: {
            ...(label.metadata || {}),
            latest_purchase_attempt: {
              status: "blocked",
              attempted_at: now,
              attempted_by_identity: identity,
              blockers,
              shipping_adapter_profile: adapterProfile,
            },
          },
        })
        .eq("id", label.id)
        .eq("store_id", storeId);

      return Response.json(
        {
          error:
            "Provider purchase is blocked until shipping label and coverage credentials are configured.",
          labelId: label.id,
          blockers,
          providerReadiness,
        },
        { status: 409 },
      );
    }

    const purchaseResult = await purchaseShippingLabel({
      orderId,
      labelId: label.id,
      method: label.resolved_shipping_method || typedOrder.shipping_method,
      carrier: typedOrder.carrier,
      subtotal: Number(typedOrder.subtotal || 0),
      shippingAmount: Number(typedOrder.shipping_amount || 0),
      itemCount: Number(typedOrder.item_count || 1),
      standardEnvelopeEstimatedOunces: metadataNumber(
        label.metadata,
        "standard_envelope_estimated_oz",
      ),
    });

    const { error: labelPurchaseError } = await supabase
      .from("order_shipping_labels")
      .update({
        provider: purchaseResult.provider,
        provider_label_id: purchaseResult.providerLabelId,
        provider_shipment_id: purchaseResult.providerShipmentId,
        provider_service: purchaseResult.providerService,
        carrier: purchaseResult.carrier,
        tracking_number: purchaseResult.trackingNumber,
        label_url: purchaseResult.labelUrl,
        label_pdf_url: purchaseResult.labelPdfUrl,
        postage_amount: purchaseResult.postageAmount,
        label_status: purchaseResult.labelStatus,
        coverage_provider: purchaseResult.coverageProvider,
        coverage_status: purchaseResult.coverageStatus,
        coverage_amount: purchaseResult.coverageAmount,
        coverage_policy_id: purchaseResult.coveragePolicyId,
        purchased_at: now,
        printed_at: purchaseResult.labelStatus === "printed" ? now : null,
        updated_at: now,
        metadata: {
          ...(label.metadata || {}),
          latest_purchase_attempt: {
            status: "dry_run_purchased",
            attempted_at: now,
            attempted_by_identity: identity,
            provider_readiness: providerReadiness,
            purchase_result: purchaseResult,
          },
        },
      })
      .eq("id", label.id)
      .eq("store_id", storeId);

    if (labelPurchaseError) throw labelPurchaseError;

    const { error: orderTrackingError } = await supabase
      .from("orders")
      .update({
        carrier: purchaseResult.carrier,
        tracking_number: purchaseResult.trackingNumber,
        updated_at: now,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (orderTrackingError) throw orderTrackingError;

    const { error: eventError } = await supabase.from("order_shipping_tracking_events").insert({
      store_id: storeId,
      order_id: orderId,
      shipping_label_id: label.id,
      provider: purchaseResult.provider,
      carrier: purchaseResult.carrier,
      tracking_number: purchaseResult.trackingNumber,
      event_type: "provider_purchase_simulated",
      event_status: purchaseResult.labelStatus,
      message: purchaseResult.message,
      occurred_at: now,
      raw_payload: {
        purchase_mode: purchaseResult.mode,
        provider_label_id: purchaseResult.providerLabelId,
        provider_shipment_id: purchaseResult.providerShipmentId,
        coverage_policy_id: purchaseResult.coveragePolicyId,
        postage_amount: purchaseResult.postageAmount,
        coverage_amount: purchaseResult.coverageAmount,
        provider_readiness: providerReadiness,
        attempted_by_identity: identity,
        provider_payload: purchaseResult.rawProviderPayload,
      },
    });

    if (eventError) throw eventError;

    return Response.json({
      success: true,
      labelId: label.id,
      labelStatus: purchaseResult.labelStatus,
      coverageStatus: purchaseResult.coverageStatus,
      providerLabelId: purchaseResult.providerLabelId,
      providerShipmentId: purchaseResult.providerShipmentId,
      trackingNumber: purchaseResult.trackingNumber,
      coveragePolicyId: purchaseResult.coveragePolicyId,
      purchaseMode: purchaseResult.mode,
      providerReadiness,
      message: purchaseResult.message,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;

    return Response.json(
      { error: error.message || "Could not attempt provider purchase." },
      { status: 500 },
    );
  }
}
