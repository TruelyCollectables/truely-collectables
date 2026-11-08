import { getClientIdentity } from "../../../../../lib/client-identity";
import {
  isBlockingDryRunShippingEvent,
  isBlockingDryRunShippingLabel,
} from "../../../../../lib/shipping-dry-run-cleanup";
import { isDryRunShippingReference } from "../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type ShippingLabelCleanupRow = {
  id: string;
  order_id: number;
  metadata: Record<string, unknown> | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  coverage_policy_id: string | null;
  label_status: string | null;
  coverage_status: string | null;
};

type TrackingEventCleanupRow = {
  id: string;
  order_id: number;
  shipping_label_id: string | null;
  event_type: string | null;
  event_status: string | null;
  message: string | null;
  tracking_number: string | null;
  raw_payload: Record<string, unknown> | null;
};

type OrderCleanupRow = {
  id: number;
  tracking_number: string | null;
  carrier: string | null;
};

function cleanText(value: unknown, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function safeAction(value: unknown) {
  return String(value || "").trim();
}

function isMissingShippingInfrastructure(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("order_shipping_labels") ||
    message.includes("order_shipping_tracking_events")
  );
}

async function loadOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("orders")
    .select("id,tracking_number,carrier")
    .eq("store_id", params.storeId)
    .eq("id", params.orderId)
    .single();

  if (error || !data) {
    throw new Response(
      JSON.stringify({ error: error?.message || "Order not found." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return data as OrderCleanupRow;
}

async function clearDryRunOrderTracking(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  order: OrderCleanupRow;
  identity: Awaited<ReturnType<typeof getClientIdentity>>;
  note: string | null;
}) {
  if (!isDryRunShippingReference(params.order.tracking_number)) {
    return false;
  }

  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("orders")
    .update({
      tracking_number: null,
      carrier: null,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .eq("id", params.order.id);

  if (error) throw error;

  const { error: eventError } = await params.supabase
    .from("order_shipping_tracking_events")
    .insert({
      store_id: params.storeId,
      order_id: params.order.id,
      provider: "tcos",
      carrier: params.order.carrier,
      tracking_number: null,
      event_type: "dry_run_order_tracking_cleared",
      event_status: "retired",
      message:
        "Admin cleared TCOS dry-run order tracking during launch cleanup. Add real carrier proof before shipment or payout release.",
      occurred_at: now,
      raw_payload: {
        dry_run_cleanup: {
          status: "retired_from_launch_cleanup",
          action: "clear_order_tracking",
          retired_at: now,
          retired_by_identity: params.identity,
          previous_tracking_number: params.order.tracking_number,
          previous_carrier: params.order.carrier,
          note: params.note,
        },
      },
    });

  if (eventError && !isMissingShippingInfrastructure(eventError)) {
    throw eventError;
  }

  return true;
}

async function retireDryRunLabelsForOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
  identity: Awaited<ReturnType<typeof getClientIdentity>>;
  note: string | null;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_labels")
    .select(
      "id,order_id,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id,label_status,coverage_status",
    )
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId);

  if (error) throw error;

  const now = new Date().toISOString();
  let retiredCount = 0;

  for (const label of (data || []) as ShippingLabelCleanupRow[]) {
    if (!isBlockingDryRunShippingLabel(label)) continue;

    const cleanupMetadata = {
      ...(label.metadata || {}),
      dry_run_cleanup: {
        status: "retired_from_launch_cleanup",
        action: "retire_label",
        retired_at: now,
        retired_by_identity: params.identity,
        previous_label_status: label.label_status,
        previous_coverage_status: label.coverage_status,
        previous_provider_label_id: label.provider_label_id,
        previous_provider_shipment_id: label.provider_shipment_id,
        previous_tracking_number: label.tracking_number,
        previous_coverage_policy_id: label.coverage_policy_id,
        note: params.note,
      },
    };

    const { error: updateError } = await params.supabase
      .from("order_shipping_labels")
      .update({
        provider_label_id: null,
        provider_shipment_id: null,
        tracking_number: null,
        coverage_policy_id: null,
        label_status: "voided",
        coverage_status: "failed",
        voided_at: now,
        updated_at: now,
        metadata: cleanupMetadata,
      })
      .eq("store_id", params.storeId)
      .eq("id", label.id);

    if (updateError) throw updateError;

    const { error: eventError } = await params.supabase
      .from("order_shipping_tracking_events")
      .insert({
        store_id: params.storeId,
        order_id: params.orderId,
        shipping_label_id: label.id,
        provider: "tcos",
        carrier: null,
        tracking_number: null,
        event_type: "dry_run_label_retired",
        event_status: "retired",
        message:
          "Admin retired a TCOS dry-run shipping label from launch cleanup. No provider void was submitted because no real label existed.",
        occurred_at: now,
        raw_payload: {
          dry_run_cleanup: cleanupMetadata.dry_run_cleanup,
        },
      });

    if (eventError && !isMissingShippingInfrastructure(eventError)) {
      throw eventError;
    }

    retiredCount += 1;
  }

  return retiredCount;
}

async function retireDryRunEventsForOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
  identity: Awaited<ReturnType<typeof getClientIdentity>>;
  note: string | null;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_tracking_events")
    .select(
      "id,order_id,shipping_label_id,event_type,event_status,message,tracking_number,raw_payload",
    )
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId);

  if (error) throw error;

  const now = new Date().toISOString();
  let retiredCount = 0;

  for (const event of (data || []) as TrackingEventCleanupRow[]) {
    if (!isBlockingDryRunShippingEvent(event)) continue;

    const rawPayload = {
      ...(event.raw_payload || {}),
      dry_run_cleanup: {
        status: "retired_from_launch_cleanup",
        action: "retire_event",
        retired_at: now,
        retired_by_identity: params.identity,
        previous_event_type: event.event_type,
        previous_event_status: event.event_status,
        previous_tracking_number: event.tracking_number,
        note: params.note,
      },
    };

    const { error: updateError } = await params.supabase
      .from("order_shipping_tracking_events")
      .update({
        event_type:
          event.event_type === "provider_purchase_simulated"
            ? "provider_purchase_simulated_retired"
            : "dry_run_tracking_event_retired",
        event_status: "retired",
        message: `${
          event.message || "Dry-run tracking event"
        } Retired from launch cleanup; add real carrier proof before fulfillment use.`,
        tracking_number: null,
        raw_payload: rawPayload,
      })
      .eq("store_id", params.storeId)
      .eq("id", event.id);

    if (updateError) throw updateError;
    retiredCount += 1;
  }

  return retiredCount;
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = safeAction(body.action);
    const orderId = Number(body.orderId);
    const note = cleanText(body.note);

    if (!orderId || action !== "retire_order_dry_run_proof") {
      return Response.json(
        { error: "Missing order id or valid dry-run cleanup action." },
        { status: 400 },
      );
    }

    if (!note || note.length < 8) {
      return Response.json(
        {
          error:
            "Add a cleanup note with the reason before retiring dry-run shipping proof.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const order = await loadOrder({ supabase, storeId, orderId });

    const [labelsRetired, eventsRetired, orderTrackingCleared] =
      await Promise.all([
        retireDryRunLabelsForOrder({
          supabase,
          storeId,
          orderId,
          identity,
          note,
        }),
        retireDryRunEventsForOrder({
          supabase,
          storeId,
          orderId,
          identity,
          note,
        }),
        clearDryRunOrderTracking({
          supabase,
          storeId,
          order,
          identity,
          note,
        }),
      ]);

    return Response.json({
      success: true,
      orderId,
      labelsRetired,
      eventsRetired,
      orderTrackingCleared,
      message:
        "Dry-run shipping proof was retired for launch cleanup. Record real carrier/Coverage proof before shipment or payout release.",
    });
  } catch (error: any) {
    if (error instanceof Response) return error;

    return Response.json(
      { error: error.message || "Could not retire dry-run shipping proof." },
      { status: 500 },
    );
  }
}
