import { getClientIdentity } from "@/src/lib/client-identity";
import { PARCEL_INCLUDED_COVERAGE_LIMIT } from "@/src/lib/shipping";
import {
  getShipStationParcelBridgeStatus,
  purchaseShipStationParcelPostage,
  type ShipStationParcelMethod,
} from "@/src/lib/shipstation-parcel";
import { isDryRunShippingLabel } from "@/src/lib/shipping-dry-run";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: number;
  subtotal: number | string | null;
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
  coverage_status: string | null;
  coverage_amount: number | string | null;
  coverage_policy_id: string | null;
  metadata: Record<string, unknown> | null;
};

type StoredParcelPurchase = {
  status?: unknown;
  claim_id?: unknown;
  provider_label_id?: unknown;
  provider_shipment_id?: unknown;
  tracking_number?: unknown;
  postage_amount?: unknown;
  provider_pdf_url?: unknown;
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
    "shipstation_parcel_postage",
  ) as StoredParcelPurchase | null;
}

function isCompletedPurchase(value: StoredParcelPurchase | null) {
  return Boolean(
    value?.status === "purchased" &&
      cleanText(value.provider_label_id) &&
      cleanText(value.provider_shipment_id) &&
      cleanText(value.tracking_number) &&
      cleanText(value.provider_pdf_url) &&
      Number.isFinite(Number(value.postage_amount)),
  );
}

function isLockedPurchase(value: StoredParcelPurchase | null) {
  return (
    value?.status === "purchase_in_progress" ||
    value?.status === "purchase_unknown"
  );
}

function proxyPdfUrl(orderId: number) {
  return `/api/admin/orders/${orderId}/shipstation-parcel/pdf`;
}

function parcelMethod(value: string | null): ShipStationParcelMethod | null {
  return value === "GROUND_ADVANTAGE" || value === "PRIORITY_MAIL"
    ? value
    : null;
}

async function loadOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("orders")
    .select(
      "id,subtotal,shipping_name,customer_name,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country",
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
      "id,order_id,label_status,resolved_shipping_method,provider_label_id,provider_shipment_id,tracking_number,coverage_status,coverage_amount,coverage_policy_id,metadata",
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

function reusedPurchaseResponse(orderId: number, previous: StoredParcelPurchase) {
  return Response.json({
    success: true,
    reused: true,
    postagePurchased: true,
    provider: "ShipStation",
    providerLabelId: cleanText(previous.provider_label_id),
    providerShipmentId: cleanText(previous.provider_shipment_id),
    trackingNumber: cleanText(previous.tracking_number),
    postageAmount: Number(previous.postage_amount),
    labelPdfUrl: proxyPdfUrl(orderId),
    message:
      "Existing ShipStation parcel postage was reused. No second provider charge was submitted.",
  });
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

    const bridge = getShipStationParcelBridgeStatus();
    if (!bridge.ready) {
      return Response.json(
        {
          error: "The ShipStation parcel bridge is not ready for live purchase.",
          bridge: {
            enabled: bridge.enabled,
            ready: bridge.ready,
            missing: bridge.missing,
            provider: bridge.provider,
          },
        },
        { status: 409 },
      );
    }

    const packageInput = {
      ounces: Number(body.ounces),
      lengthIn: Number(body.lengthIn),
      widthIn: Number(body.widthIn),
      heightIn: Number(body.heightIn),
    };

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const order = await loadOrder({ supabase, storeId, orderId });
    const label = await loadActiveLabel({ supabase, storeId, orderId });

    if (!label) {
      return Response.json(
        {
          error:
            "Prepare the shipping label record before purchasing ShipStation parcel postage.",
        },
        { status: 409 },
      );
    }

    const method = parcelMethod(label.resolved_shipping_method);
    if (!method) {
      return Response.json(
        {
          error:
            "Direct ShipStation parcel purchase is only available for Ground Advantage or Priority Mail orders.",
        },
        { status: 409 },
      );
    }

    if (isDryRunShippingLabel(label)) {
      return Response.json(
        {
          error:
            "The active parcel label is a dry-run simulation. Clean it up or replace it before buying real postage.",
        },
        { status: 409 },
      );
    }

    const previous = storedPurchase(label);
    if (isCompletedPurchase(previous)) {
      return reusedPurchaseResponse(orderId, previous!);
    }
    if (isLockedPurchase(previous)) {
      return Response.json(
        {
          error:
            "A ShipStation parcel purchase is already in progress or has an uncertain provider result. TCOS locked this order to prevent a duplicate charge. Reconcile the existing attempt before retrying.",
          purchaseStatus: previous?.status || null,
          claimId: cleanText(previous?.claim_id),
        },
        { status: 409 },
      );
    }

    if (
      [
        cleanText(label.provider_label_id),
        cleanText(label.provider_shipment_id),
        cleanText(label.tracking_number),
      ].some(Boolean)
    ) {
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

    const orderValue = Number(order.subtotal || 0);
    if (orderValue > PARCEL_INCLUDED_COVERAGE_LIMIT) {
      const coverageAmount = Number(label.coverage_amount || 0);
      const additionalCoverageReady =
        label.coverage_status === "covered" &&
        Boolean(cleanText(label.coverage_policy_id)) &&
        Number.isFinite(coverageAmount) &&
        coverageAmount >= orderValue;

      if (!additionalCoverageReady) {
        return Response.json(
          {
            error: `This $${orderValue.toFixed(2)} parcel exceeds the $${PARCEL_INCLUDED_COVERAGE_LIMIT.toFixed(2)} included carrier-coverage limit. Record additional coverage for the full order value before buying postage.`,
            coverageRequired: true,
            orderValue,
            includedCoverageLimit: PARCEL_INCLUDED_COVERAGE_LIMIT,
            recordedCoverageAmount: coverageAmount,
          },
          { status: 409 },
        );
      }
    }

    const claimId = `shipstation-parcel-${crypto.randomUUID()}`;
    const claimedAt = new Date().toISOString();
    const claimMetadata = {
      ...(label.metadata || {}),
      shipstation_parcel_postage: {
        status: "purchase_in_progress",
        claim_id: claimId,
        claimed_at: claimedAt,
        claimed_by_identity: identity,
        method,
        package: packageInput,
      },
      latest_purchase_attempt: {
        status: "shipstation_parcel_postage_claimed",
        attempted_at: claimedAt,
        attempted_by_identity: identity,
        claim_id: claimId,
        method,
        package: packageInput,
      },
    };

    let claimQuery = supabase
      .from("order_shipping_labels")
      .update({
        label_status: "rate_selected",
        metadata: claimMetadata,
        updated_at: claimedAt,
      })
      .eq("id", label.id)
      .eq("store_id", storeId);
    claimQuery =
      label.label_status === null
        ? claimQuery.is("label_status", null)
        : claimQuery.eq("label_status", label.label_status);

    const { data: claimedRows, error: claimError } = await claimQuery.select("id");
    if (claimError) throw claimError;
    if (!claimedRows?.length) {
      const refreshed = await loadActiveLabel({ supabase, storeId, orderId });
      const refreshedPurchase = refreshed ? storedPurchase(refreshed) : null;
      if (isCompletedPurchase(refreshedPurchase)) {
        return reusedPurchaseResponse(orderId, refreshedPurchase!);
      }
      return Response.json(
        {
          error:
            "Another shipping action changed this label before the ShipStation purchase lock was acquired. No provider charge was submitted.",
        },
        { status: 409 },
      );
    }

    let purchase;
    try {
      purchase = await purchaseShipStationParcelPostage({
        orderId,
        method,
        ...packageInput,
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
    } catch (providerError: any) {
      const failedAt = new Date().toISOString();
      await supabase
        .from("order_shipping_labels")
        .update({
          label_status: "rate_selected",
          updated_at: failedAt,
          metadata: {
            ...claimMetadata,
            shipstation_parcel_postage: {
              ...claimMetadata.shipstation_parcel_postage,
              status: "purchase_unknown",
              failed_at: failedAt,
              provider_error:
                providerError?.message || "Unknown ShipStation provider error.",
            },
            latest_purchase_attempt: {
              status: "shipstation_parcel_postage_unknown",
              attempted_at: failedAt,
              attempted_by_identity: identity,
              claim_id: claimId,
              provider_error:
                providerError?.message || "Unknown ShipStation provider error.",
              duplicate_purchase_locked: true,
            },
          },
        })
        .eq("id", label.id)
        .eq("store_id", storeId)
        .eq("label_status", "rate_selected");

      return Response.json(
        {
          error:
            "ShipStation did not return a safely reconcilable parcel purchase result. TCOS locked this order against retry to prevent a duplicate charge. Check ShipStation before clearing the attempt.",
          providerError:
            providerError?.message || "Unknown ShipStation provider error.",
          claimId,
          duplicatePurchaseLocked: true,
        },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    const providerService =
      method === "PRIORITY_MAIL" ? "USPS Priority Mail" : "USPS Ground Advantage";
    const stored = {
      status: "purchased",
      claim_id: claimId,
      provider: "ShipStation",
      provider_label_id: purchase.labelId,
      provider_shipment_id: purchase.shipmentId,
      carrier_id: purchase.carrierId,
      service_code: purchase.serviceCode,
      package_code: purchase.packageCode,
      postage_amount: purchase.postageAmount,
      provider_pdf_url: purchase.labelPdfUrl,
      tracking_number: purchase.trackingNumber,
      package: packageInput,
      purchased_at: now,
      purchased_by_identity: identity,
    };

    const { data: savedRows, error: updateError } = await supabase
      .from("order_shipping_labels")
      .update({
        provider: "ShipStation",
        provider_label_id: purchase.labelId,
        provider_shipment_id: purchase.shipmentId,
        provider_service: providerService,
        carrier: "USPS",
        tracking_number: purchase.trackingNumber,
        label_url: proxyPdfUrl(orderId),
        label_pdf_url: proxyPdfUrl(orderId),
        postage_amount: purchase.postageAmount,
        label_status: "purchased",
        purchased_at: now,
        updated_at: now,
        metadata: {
          ...(label.metadata || {}),
          shipstation_parcel_postage: stored,
          latest_purchase_attempt: {
            status: "shipstation_parcel_postage_purchased",
            attempted_at: now,
            attempted_by_identity: identity,
            claim_id: claimId,
            provider_label_id: purchase.labelId,
            provider_shipment_id: purchase.shipmentId,
            tracking_number: purchase.trackingNumber,
            postage_amount: purchase.postageAmount,
          },
        },
      })
      .eq("id", label.id)
      .eq("store_id", storeId)
      .eq("label_status", "rate_selected")
      .select("id");

    if (updateError || !savedRows?.length) {
      return Response.json(
        {
          error:
            "ShipStation appears to have purchased parcel postage, but TCOS could not persist the final provider result. DO NOT retry this purchase. Reconcile the ShipStation label using the locked claim.",
          claimId,
          duplicatePurchaseLocked: true,
        },
        { status: 500 },
      );
    }

    const { error: orderUpdateError } = await supabase
      .from("orders")
      .update({
        carrier: "USPS",
        tracking_number: purchase.trackingNumber,
        updated_at: now,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    const { error: eventError } = await supabase
      .from("order_shipping_tracking_events")
      .insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: "ShipStation",
        carrier: "USPS",
        tracking_number: purchase.trackingNumber,
        event_type: "shipstation_parcel_postage_purchased",
        event_status: "purchased",
        message: `${providerService} postage was purchased through ShipStation and the printable label is ready in TCOS.`,
        occurred_at: now,
        raw_payload: {
          claim_id: claimId,
          provider_label_id: purchase.labelId,
          provider_shipment_id: purchase.shipmentId,
          carrier_id: purchase.carrierId,
          service_code: purchase.serviceCode,
          package_code: purchase.packageCode,
          tracking_number: purchase.trackingNumber,
          postage_amount: purchase.postageAmount,
          package: packageInput,
          purchased_by_identity: identity,
        },
      });

    return Response.json({
      success: true,
      reused: false,
      postagePurchased: true,
      provider: "ShipStation",
      method,
      providerLabelId: purchase.labelId,
      providerShipmentId: purchase.shipmentId,
      trackingNumber: purchase.trackingNumber,
      postageAmount: purchase.postageAmount,
      labelPdfUrl: proxyPdfUrl(orderId),
      warnings: [orderUpdateError?.message, eventError?.message].filter(Boolean),
      message: `${providerService} postage purchased. USPS tracking is saved and the 4×6 PDF is ready to print from TruelyCollectables.`,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error?.message || "Could not purchase ShipStation parcel postage." },
      { status: 500 },
    );
  }
}
