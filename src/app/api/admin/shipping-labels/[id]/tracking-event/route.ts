import { getClientIdentity } from "../../../../../../lib/client-identity";
import { isDryRunShippingReference } from "../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const allowedStatuses = new Set([
  "imb_recorded",
  "accepted",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_exception",
  "returned",
  "not_delivered",
]);

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_status: string | null;
  resolved_shipping_method: string | null;
  metadata: Record<string, unknown> | null;
};

function cleanText(value: unknown, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return allowedStatuses.has(status) ? status : null;
}

function cleanOccurredAt(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return new Date().toISOString();

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function statusMessage(status: string) {
  if (status === "delivered") {
    return "LetterTrack / USPS IMb evidence shows delivered.";
  }
  if (status === "out_for_delivery") {
    return "LetterTrack / USPS IMb evidence shows out for delivery.";
  }
  if (status === "delivery_exception") {
    return "LetterTrack / USPS IMb evidence shows a delivery exception.";
  }
  if (status === "not_delivered") {
    return "LetterTrack / USPS IMb evidence does not show delivered.";
  }
  if (status === "returned") {
    return "LetterTrack / USPS IMb evidence shows returned mail.";
  }

  return `LetterTrack / USPS IMb evidence recorded as ${status.replaceAll("_", " ")}.`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const labelId = String(id || "").trim();

    if (!labelId) {
      return Response.json({ error: "Missing shipping label id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const eventStatus = cleanStatus(body.status);

    if (!eventStatus) {
      return Response.json(
        {
          error:
            "Choose a valid LetterTrack status: delivered, out_for_delivery, delivery_exception, returned, not_delivered, in_transit, accepted, or imb_recorded.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);

    const { data: labelData, error: labelError } = await supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,provider,carrier,tracking_number,label_status,resolved_shipping_method,metadata",
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

    if (label.resolved_shipping_method !== "STANDARD_ENVELOPE") {
      return Response.json(
        {
          error:
            "LetterTrack delivery evidence can only be recorded for Standard Envelope labels.",
        },
        { status: 409 },
      );
    }

    const trackingNumber =
      cleanText(body.trackingNumber, 240) || label.tracking_number;
    const providerEventId = cleanText(body.providerEventId, 240);
    const location = cleanText(body.location, 240);
    const note = cleanText(body.note, 2000);
    const occurredAt = cleanOccurredAt(body.occurredAt);

    if (!trackingNumber) {
      return Response.json(
        {
          error:
            "Record the assigned LetterTrack IMb/tracking reference before adding delivery evidence.",
        },
        { status: 400 },
      );
    }

    if (
      isDryRunShippingReference(trackingNumber) ||
      isDryRunShippingReference(providerEventId)
    ) {
      return Response.json(
        {
          error:
            "LetterTrack delivery evidence must use real provider references, not TCOS dry-run references.",
        },
        { status: 409 },
      );
    }

    const eventType = `lettertrack_${eventStatus}`;
    const message = note || statusMessage(eventStatus);

    const { error: eventError } = await supabase
      .from("order_shipping_tracking_events")
      .insert({
        store_id: storeId,
        order_id: label.order_id,
        shipping_label_id: label.id,
        provider: "LetterTrack / USPS IMb",
        carrier: "USPS IMb",
        tracking_number: trackingNumber,
        event_type: eventType,
        event_code: providerEventId,
        event_status: eventStatus,
        message,
        location,
        occurred_at: occurredAt,
        raw_payload: {
          recorded_by_identity: identity,
          provider_event_id: providerEventId,
          source: "admin_lettertrack_delivery_evidence",
          note,
        },
      });

    if (eventError) throw eventError;

    const labelUpdate: Record<string, unknown> = {
      tracking_number: trackingNumber,
      carrier: "USPS IMb",
      updated_at: new Date().toISOString(),
      metadata: {
        ...(label.metadata || {}),
        latest_lettertrack_delivery_evidence: {
          status: eventStatus,
          event_type: eventType,
          provider_event_id: providerEventId,
          tracking_number: trackingNumber,
          occurred_at: occurredAt,
          location,
          message,
          recorded_by_identity: identity,
        },
      },
    };

    if (eventStatus === "delivered") {
      labelUpdate.label_status = "delivered";
      labelUpdate.coverage_status = "covered";
    }

    const { error: labelUpdateError } = await supabase
      .from("order_shipping_labels")
      .update(labelUpdate)
      .eq("store_id", storeId)
      .eq("id", label.id);

    if (labelUpdateError) throw labelUpdateError;

    return Response.json({
      success: true,
      labelId: label.id,
      eventStatus,
      eventType,
      trackingNumber,
      occurredAt,
      message: "LetterTrack delivery evidence recorded.",
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not record LetterTrack delivery evidence." },
      { status: 500 },
    );
  }
}
