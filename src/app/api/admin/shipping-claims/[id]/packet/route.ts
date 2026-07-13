import { NextResponse } from "next/server";
import { createEvidencePdf } from "../../../../../../lib/evidence-pdf";
import {
  buildLetterTrackDeliveryEvidenceSummary,
  evaluateLetterTrackSellerProtectionPaymentGate,
  type LetterTrackDeliveryEvidenceEvent,
} from "../../../../../../lib/lettertrack-delivery-evidence";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
} from "../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type CoverageClaimRow = {
  id: string;
  order_id: number;
  shipping_label_id: string | null;
  provider: string | null;
  provider_claim_id: string | null;
  claim_status: string | null;
  claim_type: string | null;
  claim_amount: number | string | null;
  reason: string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

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
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  provider_rate_id: string | null;
  provider_service: string | null;
  service_level: string | null;
  carrier: string | null;
  tracking_number: string | null;
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

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function packetFilename(orderId: number | string, claimId: string) {
  return `shipping-coverage-claim-order-${orderId}-${claimId}.pdf`;
}

function buildReport(input: {
  claim: CoverageClaimRow;
  order: OrderRow | null;
  label: ShippingLabelRow | null;
  events: TrackingEventRow[];
  optionalErrors: string[];
}) {
  const { claim, order, label: shippingLabel, events, optionalErrors } = input;
  const dryRunEvidence =
    isDryRunShippingLabel(shippingLabel) ||
    isDryRunShippingReference(order?.tracking_number) ||
    events.some((event) => event.event_type === "provider_purchase_simulated");
  const under20ProtectionClaim = recordValue(
    recordValue(claim.metadata).under_20_seller_protection_claim,
  );
  const letterTrackDeliveryEvidence = recordValue(
    recordValue(claim.metadata).lettertrack_delivery_evidence,
  );
  const latestLetterTrackDeliveryEvidenceReview = recordValue(
    recordValue(claim.metadata).latest_lettertrack_delivery_evidence_review,
  );
  const latestLetterTrackDeliveryEvidenceReviewSummary = recordValue(
    latestLetterTrackDeliveryEvidenceReview.summary,
  );
  const latestLetterTrackDeliveryEvidenceReviewGate = recordValue(
    latestLetterTrackDeliveryEvidenceReview.gate,
  );
  const letterTrackSellerProtectionPaymentGate = recordValue(
    recordValue(claim.metadata).latest_lettertrack_seller_protection_payment_gate,
  );
  const letterTrackSellerProtectionPaymentGateDecision = recordValue(
    letterTrackSellerProtectionPaymentGate.gate,
  );
  const currentLetterTrackDeliveryEvidence =
    buildLetterTrackDeliveryEvidenceSummary(
      events as LetterTrackDeliveryEvidenceEvent[],
    );
  const currentLetterTrackPaymentGate =
    under20ProtectionClaim.eligible === true
      ? evaluateLetterTrackSellerProtectionPaymentGate({
          evidence: currentLetterTrackDeliveryEvidence,
        })
      : null;
  const lines: string[] = [
    "TCOS SHIPPING COVERAGE CLAIM PACKET",
    "Generated from TCOS order, shipping label, tracking, and coverage claim records.",
    "Use this packet with carrier scans, buyer messages, photos, and provider-specific forms.",
    ...(dryRunEvidence
      ? [
          ...section("Dry-Run Safety Notice"),
          "This claim packet includes TCOS dry-run shipping evidence.",
          "No real postage was purchased, no real USPS label was printed, and no external Coverage policy or claim should be submitted from dry-run references.",
          "Use this packet for internal QA/audit only. Replace dry-run label, tracking, shipment, and Coverage references before filing with a provider.",
        ]
      : []),
    ...section("Claim Summary"),
    line("Claim ID", claim.id),
    line("Provider", claim.provider || "Coverage"),
    line("Provider Claim ID", claim.provider_claim_id),
    line("Status", label(claim.claim_status)),
    line("Type", label(claim.claim_type)),
    line("Amount", money(claim.claim_amount)),
    line("Reason", claim.reason),
    line("Submitted At", claim.submitted_at),
    line("Resolved At", claim.resolved_at),
    line("Created At", claim.created_at),
    line("Updated At", claim.updated_at),
    ...(Object.keys(under20ProtectionClaim).length > 0
      ? [
          ...section("Under-$20 Seller Protection"),
          line("Program", under20ProtectionClaim.program),
          line(
            "Seller Opted In",
            under20ProtectionClaim.sellerOptedIn ? "Yes" : "No",
          ),
          line("Eligible", under20ProtectionClaim.eligible ? "Yes" : "No"),
          line(
            "Protected Item Amount",
            money(under20ProtectionClaim.protectedItemAmount as number),
          ),
          line(
            "Seller Reimbursement Amount",
            money(under20ProtectionClaim.reimbursableItemAmount as number),
          ),
          line(
            "Shipping Excluded",
            under20ProtectionClaim.reimbursesShipping === false ? "Yes" : "No",
          ),
          line(
            "Shipping Excluded Amount",
            money(under20ProtectionClaim.shippingExcludedAmount as number),
          ),
          line("Coverage Basis", under20ProtectionClaim.coverageBasis),
          line(
            "Seller Refund Responsibility",
            under20ProtectionClaim.sellerRefundResponsibility,
          ),
          line("Reimbursement Rule", under20ProtectionClaim.reimbursementRule),
        ]
      : []),
    ...(Object.keys(letterTrackDeliveryEvidence).length > 0
      ? [
          ...section("LetterTrack Delivery Evidence Snapshot"),
          line("Provider", letterTrackDeliveryEvidence.provider),
          line("Evidence Events", letterTrackDeliveryEvidence.eventCount),
          line(
            "Delivered Evidence Present",
            letterTrackDeliveryEvidence.deliveredEvidencePresent ? "Yes" : "No",
          ),
          line(
            "Claim Review Supported",
            letterTrackDeliveryEvidence.claimReviewSupported ? "Yes" : "No",
          ),
          line("Latest Status", letterTrackDeliveryEvidence.latestStatus),
          line("Latest Event", letterTrackDeliveryEvidence.latestEventType),
          line("Latest At", letterTrackDeliveryEvidence.latestOccurredAt),
          line(
            "Latest Tracking",
            letterTrackDeliveryEvidence.latestTrackingNumber,
          ),
          line("Latest Message", letterTrackDeliveryEvidence.latestMessage),
          line("Latest Location", letterTrackDeliveryEvidence.latestLocation),
          line("Delivered At", letterTrackDeliveryEvidence.deliveredAt),
          line("Review Rule", letterTrackDeliveryEvidence.claimReviewReason),
        ]
      : []),
    ...(Object.keys(latestLetterTrackDeliveryEvidenceReviewSummary).length > 0
      ? [
          ...section("Latest Saved LetterTrack Evidence Review"),
          "This section was saved during the latest under-$20 seller-protection claim status change.",
          line("Reviewed Claim Status", latestLetterTrackDeliveryEvidenceReview.status),
          line("Reviewed At", latestLetterTrackDeliveryEvidenceReview.reviewed_at),
          line("Review Note", latestLetterTrackDeliveryEvidenceReview.note),
          line(
            "Review Payout Gate Allowed",
            latestLetterTrackDeliveryEvidenceReviewGate.allowed ? "Yes" : "No",
          ),
          line(
            "Review Override Accepted",
            latestLetterTrackDeliveryEvidenceReviewGate.overrideAccepted
              ? "Yes"
              : "No",
          ),
          line("Review Gate Reason", latestLetterTrackDeliveryEvidenceReviewGate.reason),
          line("Review Provider", latestLetterTrackDeliveryEvidenceReviewSummary.provider),
          line(
            "Review Evidence Events",
            latestLetterTrackDeliveryEvidenceReviewSummary.eventCount,
          ),
          line(
            "Review Delivered Evidence",
            latestLetterTrackDeliveryEvidenceReviewSummary.deliveredEvidencePresent
              ? "Yes"
              : "No",
          ),
          line(
            "Review Claim Review Supported",
            latestLetterTrackDeliveryEvidenceReviewSummary.claimReviewSupported
              ? "Yes"
              : "No",
          ),
          line(
            "Review Latest Status",
            latestLetterTrackDeliveryEvidenceReviewSummary.latestStatus,
          ),
          line(
            "Review Latest Tracking",
            latestLetterTrackDeliveryEvidenceReviewSummary.latestTrackingNumber,
          ),
          line(
            "Review Delivered At",
            latestLetterTrackDeliveryEvidenceReviewSummary.deliveredAt,
          ),
          line(
            "Review Rule",
            latestLetterTrackDeliveryEvidenceReviewSummary.claimReviewReason,
          ),
        ]
      : []),
    ...(currentLetterTrackDeliveryEvidence.eventCount > 0
      ? [
          ...section("Current LetterTrack Evidence Review"),
          "This section is recalculated from the current tracking-event records included in this packet.",
          line("Provider", currentLetterTrackDeliveryEvidence.provider),
          line("Current Evidence Events", currentLetterTrackDeliveryEvidence.eventCount),
          line(
            "Current Delivered Evidence",
            currentLetterTrackDeliveryEvidence.deliveredEvidencePresent
              ? "Yes"
              : "No",
          ),
          line(
            "Current Claim Review Supported",
            currentLetterTrackDeliveryEvidence.claimReviewSupported
              ? "Yes"
              : "No",
          ),
          line("Current Latest Status", currentLetterTrackDeliveryEvidence.latestStatus),
          line("Current Latest Event", currentLetterTrackDeliveryEvidence.latestEventType),
          line("Current Latest At", currentLetterTrackDeliveryEvidence.latestOccurredAt),
          line(
            "Current Latest Tracking",
            currentLetterTrackDeliveryEvidence.latestTrackingNumber,
          ),
          line("Current Delivered At", currentLetterTrackDeliveryEvidence.deliveredAt),
          line("Current Review Rule", currentLetterTrackDeliveryEvidence.claimReviewReason),
          ...(currentLetterTrackPaymentGate
            ? [
                line(
                  "Current Payout Gate Allowed",
                  currentLetterTrackPaymentGate.allowed ? "Yes" : "No",
                ),
                line(
                  "Current Payout Override Accepted",
                  currentLetterTrackPaymentGate.overrideAccepted ? "Yes" : "No",
                ),
                line("Current Payout Gate Reason", currentLetterTrackPaymentGate.reason),
              ]
            : []),
        ]
      : []),
    ...(Object.keys(letterTrackSellerProtectionPaymentGate).length > 0
      ? [
          ...section("LetterTrack Seller-Protection Payout Gate"),
          line(
            "Payout Allowed",
            letterTrackSellerProtectionPaymentGateDecision.allowed
              ? "Yes"
              : "No",
          ),
          line(
            "Override Accepted",
            letterTrackSellerProtectionPaymentGateDecision.overrideAccepted
              ? "Yes"
              : "No",
          ),
          line("Gate Reason", letterTrackSellerProtectionPaymentGateDecision.reason),
          line(
            "Gate Delivered Evidence",
            recordValue(letterTrackSellerProtectionPaymentGate.summary)
              .deliveredEvidencePresent
              ? "Yes"
              : "No",
          ),
          line(
            "Gate Claim Review Supported",
            recordValue(letterTrackSellerProtectionPaymentGate.summary)
              .claimReviewSupported
              ? "Yes"
              : "No",
          ),
          line(
            "Gate Latest Status",
            recordValue(letterTrackSellerProtectionPaymentGate.summary)
              .latestStatus,
          ),
          line(
            "Gate Latest Tracking",
            recordValue(letterTrackSellerProtectionPaymentGate.summary)
              .latestTrackingNumber,
          ),
        ]
      : []),
    ...section("Order Snapshot"),
  ];

  if (order) {
    lines.push(
      line("Order ID", order.id),
      line("Order Created", order.created_at),
      line("Customer Email", order.customer_email),
      line("Customer Name", order.customer_name),
      line("Order Status", label(order.status)),
      line("Payment Status", label(order.payment_status)),
      line("Fulfillment Status", label(order.fulfillment_status)),
      line("Subtotal", money(order.subtotal)),
      line("Shipping Amount", money(order.shipping_amount)),
      line("Total", money(order.total)),
      line("Requested Shipping Method", order.shipping_method),
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
    lines.push("Order was not found for this claim.");
  }

  lines.push(...section("Shipping Label + Coverage"));

  if (shippingLabel) {
    lines.push(
      line("Label ID", shippingLabel.id),
      line("Provider", shippingLabel.provider),
      line("Provider Label ID", shippingLabel.provider_label_id),
      line("Provider Shipment ID", shippingLabel.provider_shipment_id),
      line("Provider Rate ID", shippingLabel.provider_rate_id),
      line("Provider Service", shippingLabel.provider_service),
      line("Service Level", shippingLabel.service_level),
      line("Carrier", shippingLabel.carrier),
      line("Tracking Number", shippingLabel.tracking_number),
      line("Label Status", label(shippingLabel.label_status)),
      line("Postage", `${money(shippingLabel.postage_amount)} ${shippingLabel.currency || "USD"}`),
      line("Requested Method", shippingLabel.requested_shipping_method),
      line("Resolved Method", shippingLabel.resolved_shipping_method),
      line("Coverage Provider", shippingLabel.coverage_provider),
      line("Coverage Required", shippingLabel.coverage_required ? "Yes" : "No"),
      line("Coverage Status", label(shippingLabel.coverage_status)),
      line("Coverage Amount", money(shippingLabel.coverage_amount)),
      line("Coverage Policy ID", shippingLabel.coverage_policy_id),
      line("Coverage Claim ID", shippingLabel.coverage_claim_id),
      line("Coverage Claim Status", label(shippingLabel.coverage_claim_status)),
      line("Purchased At", shippingLabel.purchased_at),
      line("Printed At", shippingLabel.printed_at),
      line("Created At", shippingLabel.created_at),
      line("Updated At", shippingLabel.updated_at),
    );
  } else {
    lines.push("No shipping label record is linked to this claim.");
  }

  lines.push(...section("Tracking + Claim Events"));

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
    lines.push("No tracking or claim events were recorded for this shipment.");
  }

  lines.push(...section("Claim Metadata"), safeJson(claim.metadata));

  if (optionalErrors.length) {
    lines.push(...section("Packet Warnings"), ...optionalErrors);
  }

  lines.push(
    ...section("Admin Reminder"),
    "Provider submission is not automatic from this packet.",
    "Attach any required photos, buyer messages, carrier correspondence, and provider-specific forms before submitting.",
  );

  return lines.join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const claimId = String(id || "").trim();

    if (!claimId) {
      return NextResponse.json(
        { error: "Missing coverage claim id." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const optionalErrors: string[] = [];

    const { data: claimData, error: claimError } = await supabase
      .from("order_shipping_coverage_claims")
      .select(
        "id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_type,claim_amount,reason,submitted_at,resolved_at,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .eq("id", claimId)
      .maybeSingle();

    if (claimError) throw claimError;

    const claim = (claimData || null) as CoverageClaimRow | null;

    if (!claim?.id) {
      return NextResponse.json(
        { error: "Coverage claim was not found." },
        { status: 404 },
      );
    }

    const [
      orderResult,
      labelResult,
      eventsResult,
    ] = await Promise.all([
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
        .eq("id", claim.order_id)
        .maybeSingle(),
      claim.shipping_label_id
        ? supabase
            .from("order_shipping_labels")
            .select(
              "id,provider,provider_label_id,provider_shipment_id,provider_rate_id,provider_service,service_level,carrier,tracking_number,label_status,postage_amount,currency,requested_shipping_method,resolved_shipping_method,coverage_provider,coverage_required,coverage_status,coverage_amount,coverage_policy_id,coverage_claim_id,coverage_claim_status,purchased_at,printed_at,metadata,created_at,updated_at",
            )
            .eq("store_id", storeId)
            .eq("id", claim.shipping_label_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("order_shipping_tracking_events")
        .select(
          "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
        )
        .eq("store_id", storeId)
        .eq("order_id", claim.order_id)
        .order("occurred_at", { ascending: true })
        .limit(100),
    ]);

    if (orderResult.error) {
      optionalErrors.push(`Order lookup warning: ${orderResult.error.message}`);
    }

    if (labelResult.error) {
      optionalErrors.push(`Label lookup warning: ${labelResult.error.message}`);
    }

    if (eventsResult.error) {
      optionalErrors.push(
        `Tracking event lookup warning: ${eventsResult.error.message}`,
      );
    }

    const reportText = buildReport({
      claim,
      order: (orderResult.data || null) as OrderRow | null,
      label: (labelResult.data || null) as ShippingLabelRow | null,
      events: (eventsResult.data || []) as TrackingEventRow[],
      optionalErrors,
    });
    const pdf = createEvidencePdf(reportText);
    const body = Uint8Array.from(pdf).buffer as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${packetFilename(
          claim.order_id,
          claim.id,
        )}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not generate coverage claim packet." },
      { status: 500 },
    );
  }
}
