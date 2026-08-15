import { getClientIdentity } from "../../../../../../../lib/client-identity";
import {
  getLetterTrackShipStationBridgeStatus,
  purchaseLetterTrackShipStationPostage,
} from "../../../../../../../lib/lettertrack-shipstation";
import { isDryRunShippingLabel } from "../../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: number;
  shipping_name: string | null;
  customer_name: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
};

type ShippingLabelRow = {
  id: string;
  order_id: number;
  label_status: string | null;
  resolved_shipping_method: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  metadata: Record<string, unknown> | null;
};

type StoredPostagePurchase = {
  status?: unknown;
  provider_label_id?: unknown;
  provider_shipment_id?: unknown;
  postage_amount?: unknown;
  provider_pdf_url?: unknown;
  purchased_at?: unknown;
  service_code?: unknown;
  package_code?: unknown;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedPurchase(label: ShippingLabelRow) {
  return metadataRecord(
    label.metadata,
    "lettertrack_shipstation_postage",
  ) as StoredPostagePurchase | null;
}

function isCompletedPurchase(value: StoredPostagePurchase | null) {
  return Boolean(
    value?.status === "purchased" &&
      cleanText(value.provider_label_id) &&
      cleanText(value.provider_shipment_id) &&
      cleanText(value.provider_pdf_url) &&
      Number.isFinite(Number(value.postage_amount)),
  );
}

function proxyPdfUrl(orderId: number) {
  return `/api/admin/orders/${orderId}/lettertrack-postage/pdf`;
}

function letterTrackFinalizeUrl() {
  return "https://www.lettertrackpro.com/Login.asp";
}

async function loadOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("orders")
    .select(
      "id,shipping_name,customer_name,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country",
    )
    .eq("id", params.orderId)
    .eq("store_id", params.storeId)
    .single();

  if (error || !data) {
    throw new Response(
      JSON.stringify({ error: error?.message || "Order not found." }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return data as OrderRow;
}

async function loadActiveLabel(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_labels")
    .select(
      "id,order_id,label_status,resolved_shipping_method,provider_label_id,provider_shipment_id,tracking_number,metadata",
    )
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .not("label_status", "in", "(voided,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as ShippingLabelRow | null;
}

function addressMissing(order: OrderRow) {
  const required = {
    name: cleanText(order.shipping_name) || cleanText(order.customer_name),
    addressLine1: cleanText(order.shipping_address_line1),
    city: cleanText(order.shipping_city),
    state: cleanText(order.shipping_state),
    postalCode: cleanText(order.shipping_postal_code),
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function estimatedOunces(label: ShippingLabelRow) {
  const value = label.metadata?.standard_envelope_estimated_oz;
  const ounces = Number(value ?? 1);
  return Number.isFinite(ounces) && ounces > 0 ? ounces : 1;
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

    const body = await request.json().catch(() => ({}));
    if (body.confirmPurchase !== true) {
      return Response.json(
        {
          error:
            "Explicit postage purchase confirmation is required before TCOS can charge ShipStation.",
        },
        { status: 400 },
      );
    }

    if (body.standardEnvelopeMachinableAttested !== true) {
      return Response.json(
        {
          error:
            "Confirm the finished Standard Envelope is flexible, uniformly thick, and machinable before buying letter postage.",
        },
        { status: 400 },
      );
    }

    const bridge = getLetterTrackShipStationBridgeStatus();
    if (!bridge.ready) {
      return Response.json(
        {
          error:
            "The LetterTrack/ShipStation postage bridge is not ready for live purchase.",
          bridge: {
            enabled: bridge.enabled,
            ready: bridge.ready,
            missing: bridge.missing,
            provider: bridge.provider,
            letterTrackFinalizeRequired: bridge.letterTrackFinalizeRequired,
          },
        },
        { status: 409 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const order = await loadOrder({ supabase, storeId, orderId });
    const label = await loadActiveLabel({ supabase, storeId, orderId });

    if (!label) {
      return Response.json(
        {
          error:
            "Prepare the shipping label record before purchasing LetterTrack postage.",
        },
        { status: 409 },
      );
    }

    if (label.resolved_shipping_method !== "STANDARD_ENVELOPE") {
      return Response.json(
        {
          error:
            "Direct LetterTrack postage purchase is only available for Standard Envelope orders.",
        },
        { status: 409 },
      );
    }

    if (isDryRunShippingLabel(label)) {
      return Response.json(
        {
          error:
            "The active Standard Envelope label is a dry-run simulation. Clean it up or replace it before buying real postage.",
        },
        { status: 409 },
      );
    }

    const previous = storedPurchase(label);
    if (isCompletedPurchase(previous)) {
      return Response.json({
        success: true,
        reused: true,
        postagePurchased: true,
        letterTrackFinalizeRequired: true,
        provider: "ShipStation",
        providerLabelId: cleanText(previous?.provider_label_id),
        providerShipmentId: cleanText(previous?.provider_shipment_id),
        postageAmount: Number(previous?.postage_amount),
        labelPdfUrl: proxyPdfUrl(orderId),
        letterTrackUrl: letterTrackFinalizeUrl(),
        message:
          "Existing paid USPS letter postage was reused. No second ShipStation charge was submitted. Finalize the PDF in LetterTrack to add the IMb barcode.",
      });
    }

    const externalReferences = [
      cleanText(label.provider_label_id),
      cleanText(label.provider_shipment_id),
      cleanText(label.tracking_number),
    ].filter(Boolean);
    if (externalReferences.length > 0) {
      return Response.json(
        {
          error:
            "This label already has an external provider or tracking reference. TCOS blocked a second postage purchase for manual review.",
        },
        { status: 409 },
      );
    }

    const missingAddress = addressMissing(order);
    if (missingAddress.length > 0) {
      return Response.json(
        {
          error: `The shipping address is incomplete: ${missingAddress.join(", ")}.`,
          missingAddress,
        },
        { status: 422 },
      );
    }

    const ounces = estimatedOunces(label);
    if (ounces > 3.5) {
      return Response.json(
        {
          error:
            "The estimated Standard Envelope weight exceeds 3.5 ounces. Use a parcel service instead of letter postage.",
          estimatedOunces: ounces,
        },
        { status: 409 },
      );
    }

    const purchase = await purchaseLetterTrackShipStationPostage({
      orderId,
      ounces,
      shipTo: {
        name:
          cleanText(order.shipping_name) || cleanText(order.customer_name) || "",
        addressLine1: cleanText(order.shipping_address_line1) || "",
        addressLine2: cleanText(order.shipping_address_line2),
        city: cleanText(order.shipping_city) || "",
        state: cleanText(order.shipping_state) || "",
        postalCode: cleanText(order.shipping_postal_code) || "",
        countryCode: cleanText(order.shipping_country) || "US",
      },
    });

    const now = new Date().toISOString();
    const stored = {
      status: "purchased",
      provider: "ShipStation",
      provider_label_id: purchase.labelId,
      provider_shipment_id: purchase.shipmentId,
      carrier_id: purchase.carrierId,
      service_code: purchase.serviceCode,
      package_code: purchase.packageCode,
      postage_amount: purchase.postageAmount,
      provider_pdf_url: purchase.labelPdfUrl,
      provider_tracking_number: purchase.trackingNumber,
      provider_trackable: purchase.trackable,
      estimated_ounces: ounces,
      purchased_at: now,
      purchased_by_identity: identity,
      standard_envelope_machinable_attested: true,
      lettertrack_finalize_required: true,
      final_imb_recorded: false,
    };

    const { error: updateError } = await supabase
      .from("order_shipping_labels")
      .update({
        provider: "ShipStation + LetterTrack",
        provider_label_id: purchase.labelId,
        provider_shipment_id: purchase.shipmentId,
        provider_service: "USPS First-Class Letter postage -> LetterTrack IMb",
        carrier: "USPS",
        label_url: proxyPdfUrl(orderId),
        label_pdf_url: proxyPdfUrl(orderId),
        postage_amount: purchase.postageAmount,
        label_status: "purchase_pending",
        purchased_at: now,
        updated_at: now,
        metadata: {
          ...(label.metadata || {}),
          lettertrack_shipstation_postage: stored,
          latest_purchase_attempt: {
            status: "shipstation_letter_postage_purchased",
            attempted_at: now,
            attempted_by_identity: identity,
            provider_label_id: purchase.labelId,
            provider_shipment_id: purchase.shipmentId,
            postage_amount: purchase.postageAmount,
            lettertrack_finalize_required: true,
          },
        },
      })
      .eq("id", label.id)
      .eq("store_id", storeId);

    if (updateError) throw updateError;

    const { error: eventError } = await supabase
      .from("order_shipping_tracking_events")
      .insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: "ShipStation + LetterTrack",
        carrier: "USPS",
        tracking_number: null,
        event_type: "lettertrack_shipstation_postage_purchased",
        event_status: "purchase_pending",
        message:
          "USPS First-Class Letter postage was purchased through ShipStation. LetterTrack IMb finalization is still required before mailing.",
        occurred_at: now,
        raw_payload: {
          provider_label_id: purchase.labelId,
          provider_shipment_id: purchase.shipmentId,
          carrier_id: purchase.carrierId,
          service_code: purchase.serviceCode,
          package_code: purchase.packageCode,
          postage_amount: purchase.postageAmount,
          estimated_ounces: ounces,
          purchased_by_identity: identity,
          standard_envelope_machinable_attested: true,
          lettertrack_finalize_required: true,
        },
      });

    if (eventError) throw eventError;

    return Response.json({
      success: true,
      reused: false,
      postagePurchased: true,
      letterTrackFinalizeRequired: true,
      provider: "ShipStation",
      providerLabelId: purchase.labelId,
      providerShipmentId: purchase.shipmentId,
      postageAmount: purchase.postageAmount,
      labelPdfUrl: proxyPdfUrl(orderId),
      letterTrackUrl: letterTrackFinalizeUrl(),
      message:
        "USPS letter postage purchased through ShipStation. Print/review the paid PDF in TCOS, then process it in LetterTrack to add the IMb tracking barcode before mailing.",
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error?.message || "Could not purchase LetterTrack postage." },
      { status: 500 },
    );
  }
}
