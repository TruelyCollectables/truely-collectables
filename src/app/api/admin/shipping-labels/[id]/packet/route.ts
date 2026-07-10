import { NextResponse } from "next/server";
import { createEvidencePdf } from "../../../../../../lib/evidence-pdf";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type OrderItemRow = {
  id: number;
  seller_account_id: string | null;
  title: string | null;
  quantity: number | string | null;
  price: number | string | null;
};

type OrderRow = {
  id: number;
  created_at: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total: number | string | null;
  status: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | string | null;
  subtotal: number | string | null;
  item_count: number | string | null;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  tos_accepted: boolean | null;
  tos_version: string | null;
  tos_accepted_at: string | null;
  tos_ip_address: string | null;
  tos_ip_risk: string | null;
  order_items?: OrderItemRow[];
};

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  provider_rate_id: string | null;
  provider_service: string | null;
  service_level: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_url: string | null;
  label_pdf_url: string | null;
  label_status: string | null;
  postage_amount: number | string | null;
  currency: string | null;
  requested_shipping_method: string | null;
  resolved_shipping_method: string | null;
  coverage_provider: string | null;
  coverage_required: boolean | null;
  coverage_status: string | null;
  coverage_amount: number | string | null;
  coverage_policy_id: string | null;
  coverage_claim_id: string | null;
  coverage_claim_status: string | null;
  purchased_at: string | null;
  printed_at: string | null;
  voided_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type TrackingEventRow = {
  id: string;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  event_type: string | null;
  event_code: string | null;
  event_status: string | null;
  message: string | null;
  location: string | null;
  occurred_at: string | null;
  raw_payload: Record<string, unknown> | null;
};

type CoverageClaimRow = {
  id: string;
  provider: string | null;
  provider_claim_id: string | null;
  claim_status: string | null;
  claim_type: string | null;
  claim_amount: number | string | null;
  reason: string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string | null;
};

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function line(label: string, value: unknown) {
  const normalized =
    value === null || value === undefined || value === "" ? "Not saved" : value;

  return `${label}: ${normalized}`;
}

function section(title: string) {
  return ["", title, "----------------------------------------------"];
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function address(order: OrderRow) {
  return [
    order.shipping_address_line1,
    order.shipping_address_line2,
    [order.shipping_city, order.shipping_state, order.shipping_postal_code]
      .filter(Boolean)
      .join(", "),
    order.shipping_country,
  ]
    .filter(Boolean)
    .join(" / ");
}

function packetFilename(orderId: number | string, labelId: string) {
  return `shipping-label-packet-order-${orderId}-${labelId}.pdf`;
}

function metadataLine(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return value === null || value === undefined ? "Not saved" : value;
}

function buildReport(input: {
  labelRow: ShippingLabelRow;
  order: OrderRow | null;
  events: TrackingEventRow[];
  claims: CoverageClaimRow[];
  optionalErrors: string[];
}) {
  const { labelRow, order, events, claims, optionalErrors } = input;
  const lines: string[] = [
    "TCOS SHIPPING LABEL AUDIT PACKET",
    "Generated from TCOS order, shipping label, coverage, and tracking records.",
    "Use this packet for fulfillment review, buyer support, carrier inquiries, and claim preparation.",
    ...section("Label Summary"),
    line("Label ID", labelRow.id),
    line("Order ID", labelRow.order_id),
    line("Provider", labelRow.provider),
    line("Provider Label ID", labelRow.provider_label_id),
    line("Provider Shipment ID", labelRow.provider_shipment_id),
    line("Provider Rate ID", labelRow.provider_rate_id),
    line("Provider Service", labelRow.provider_service),
    line("Service Level", labelRow.service_level),
    line("Carrier", labelRow.carrier),
    line("Tracking Number", labelRow.tracking_number),
    line("Label Status", label(labelRow.label_status)),
    line("Postage", `${money(labelRow.postage_amount)} ${labelRow.currency || "USD"}`),
    line("Requested Shipping Method", label(labelRow.requested_shipping_method)),
    line("Resolved Shipping Method", label(labelRow.resolved_shipping_method)),
    line("Purchased At", labelRow.purchased_at),
    line("Printed At", labelRow.printed_at),
    line("Voided At", labelRow.voided_at),
    line("Created At", labelRow.created_at),
    line("Updated At", labelRow.updated_at),
    ...section("Standard Envelope Eligibility"),
    line(
      "Standard Envelope Eligible",
      metadataLine(labelRow.metadata, "standard_envelope_eligible"),
    ),
    line(
      "Standard Envelope Estimated Oz",
      metadataLine(labelRow.metadata, "standard_envelope_estimated_oz"),
    ),
    line(
      "Policy Reason",
      metadataLine(labelRow.metadata, "shipping_policy_reason"),
    ),
    line(
      "Standard Envelope Reason",
      metadataLine(labelRow.metadata, "standard_envelope_reason"),
    ),
    ...section("Coverage"),
    line("Coverage Provider", labelRow.coverage_provider),
    line("Coverage Required", labelRow.coverage_required ? "Yes" : "No"),
    line("Coverage Status", label(labelRow.coverage_status)),
    line("Coverage Amount", money(labelRow.coverage_amount)),
    line("Coverage Policy ID", labelRow.coverage_policy_id),
    line("Coverage Claim ID", labelRow.coverage_claim_id),
    line("Coverage Claim Status", label(labelRow.coverage_claim_status)),
    ...section("Order Snapshot"),
  ];

  if (order) {
    lines.push(
      line("Order Created", order.created_at),
      line("Customer Email", order.customer_email),
      line("Customer Name", order.customer_name),
      line("Order Status", label(order.status)),
      line("Payment Status", label(order.payment_status)),
      line("Fulfillment Status", label(order.fulfillment_status)),
      line("Subtotal", money(order.subtotal)),
      line("Shipping Amount", money(order.shipping_amount)),
      line("Total", money(order.total)),
      line("Item Count", order.item_count),
      line("Saved Shipping Method", order.shipping_method),
      line("Saved Shipping Name", order.shipping_name),
      line("Saved Carrier", order.carrier),
      line("Saved Tracking", order.tracking_number),
      line("Shipped At", order.shipped_at),
      line("Ship-To Address", address(order) || "Not saved"),
      line("TOS Accepted", order.tos_accepted ? "Yes" : "No"),
      line("TOS Version", order.tos_version),
      line("TOS Accepted At", order.tos_accepted_at),
      line("TOS IP", order.tos_ip_address),
      line("TOS IP Risk", order.tos_ip_risk),
      ...section("Order Items"),
    );

    if (order.order_items?.length) {
      for (const item of order.order_items) {
        lines.push(
          `#${item.id} / ${item.title || "Untitled"} / Qty ${
            item.quantity || 0
          } / ${money(item.price)} / Seller ${item.seller_account_id || "TCOS"}`,
        );
      }
    } else {
      lines.push("No order items saved on this order.");
    }
  } else {
    lines.push("Order was not found for this label.");
  }

  lines.push(...section("Tracking Events"));

  if (events.length) {
    for (const event of events) {
      lines.push(
        line("Event", `${label(event.event_type)} / ${label(event.event_status)}`),
        line("Occurred At", event.occurred_at),
        line("Provider", event.provider),
        line("Carrier", event.carrier),
        line("Tracking", event.tracking_number),
        line("Code", event.event_code),
        line("Location", event.location),
        line("Message", event.message),
        line("Raw Payload", safeJson(event.raw_payload)),
        "",
      );
    }
  } else {
    lines.push("No tracking events were recorded for this label.");
  }

  lines.push(...section("Coverage Claims"));

  if (claims.length) {
    for (const claim of claims) {
      lines.push(
        line("Claim ID", claim.id),
        line("Provider", claim.provider),
        line("Provider Claim ID", claim.provider_claim_id),
        line("Status", label(claim.claim_status)),
        line("Type", label(claim.claim_type)),
        line("Amount", money(claim.claim_amount)),
        line("Reason", claim.reason),
        line("Submitted At", claim.submitted_at),
        line("Resolved At", claim.resolved_at),
        line("Created At", claim.created_at),
        "",
      );
    }
  } else {
    lines.push("No coverage claims are linked to this label.");
  }

  lines.push(...section("Label Metadata"), safeJson(labelRow.metadata));

  if (optionalErrors.length) {
    lines.push(...section("Packet Warnings"), ...optionalErrors);
  }

  return lines.join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const labelId = String(id || "").trim();

    if (!labelId) {
      return NextResponse.json(
        { error: "Missing shipping label id." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const optionalErrors: string[] = [];

    const { data: labelData, error: labelError } = await supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,provider,provider_label_id,provider_shipment_id,provider_rate_id,provider_service,service_level,carrier,tracking_number,label_url,label_pdf_url,label_status,postage_amount,currency,requested_shipping_method,resolved_shipping_method,coverage_provider,coverage_required,coverage_status,coverage_amount,coverage_policy_id,coverage_claim_id,coverage_claim_status,purchased_at,printed_at,voided_at,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .eq("id", labelId)
      .maybeSingle();

    if (labelError) throw labelError;

    const labelRow = (labelData || null) as ShippingLabelRow | null;

    if (!labelRow?.id) {
      return NextResponse.json(
        { error: "Shipping label was not found." },
        { status: 404 },
      );
    }

    const [orderResult, eventsResult, claimsResult] = await Promise.all([
      supabase
        .from("orders")
        .select(
          `
          id,
          created_at,
          customer_email,
          customer_name,
          total,
          status,
          payment_status,
          fulfillment_status,
          shipping_method,
          shipping_name,
          shipping_amount,
          subtotal,
          item_count,
          tracking_number,
          carrier,
          shipped_at,
          shipping_address_line1,
          shipping_address_line2,
          shipping_city,
          shipping_state,
          shipping_postal_code,
          shipping_country,
          tos_accepted,
          tos_version,
          tos_accepted_at,
          tos_ip_address,
          tos_ip_risk,
          order_items (
            id,
            seller_account_id,
            title,
            quantity,
            price
          )
        `,
        )
        .eq("store_id", storeId)
        .eq("id", labelRow.order_id)
        .maybeSingle(),
      supabase
        .from("order_shipping_tracking_events")
        .select(
          "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
        )
        .eq("store_id", storeId)
        .eq("shipping_label_id", labelRow.id)
        .order("occurred_at", { ascending: true })
        .limit(100),
      supabase
        .from("order_shipping_coverage_claims")
        .select(
          "id,provider,provider_claim_id,claim_status,claim_type,claim_amount,reason,submitted_at,resolved_at,created_at",
        )
        .eq("store_id", storeId)
        .eq("shipping_label_id", labelRow.id)
        .order("created_at", { ascending: true })
        .limit(25),
    ]);

    if (orderResult.error) {
      optionalErrors.push(`Order lookup warning: ${orderResult.error.message}`);
    }

    if (eventsResult.error) {
      optionalErrors.push(
        `Tracking event lookup warning: ${eventsResult.error.message}`,
      );
    }

    if (claimsResult.error) {
      optionalErrors.push(
        `Coverage claim lookup warning: ${claimsResult.error.message}`,
      );
    }

    const reportText = buildReport({
      labelRow,
      order: (orderResult.data || null) as OrderRow | null,
      events: (eventsResult.data || []) as TrackingEventRow[],
      claims: (claimsResult.data || []) as CoverageClaimRow[],
      optionalErrors,
    });
    const pdf = createEvidencePdf(reportText);
    const body = Uint8Array.from(pdf).buffer as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${packetFilename(
          labelRow.order_id,
          labelRow.id,
        )}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not generate shipping label packet." },
      { status: 500 },
    );
  }
}
