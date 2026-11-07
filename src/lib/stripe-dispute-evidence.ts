import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createEvidencePdf } from "./evidence-pdf";
import {
  buildAndSaveOrderReviewCasePacket,
  orderReviewCasePacketFilename,
} from "./order-review-case-packet";
import { isDryRunShippingReference } from "./shipping-dry-run";

type ProviderEvidenceStatus =
  | "not_staged"
  | "staged"
  | "submitted"
  | "won"
  | "lost"
  | "failed";

type PacketProviderState = {
  id: string;
  provider_dispute_id: string | null;
  provider_evidence_status: ProviderEvidenceStatus | null;
  provider_evidence_file_id: string | null;
  provider_evidence_submitted_at: string | null;
};

function compact(value: unknown, maxLength = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function stripeTimestamp(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

function evidenceStatus(dispute: Stripe.Dispute): ProviderEvidenceStatus {
  if (dispute.status === "won") return "won";
  if (dispute.status === "lost") return "lost";
  if ((dispute.evidence_details?.submission_count || 0) > 0) return "submitted";
  if (dispute.evidence_details?.has_evidence) return "staged";
  return "not_staged";
}

function evidencePayload(
  packet: Awaited<ReturnType<typeof buildAndSaveOrderReviewCasePacket>>,
  stripeFileId: string,
): Stripe.DisputeUpdateParams.Evidence {
  const { order, reviewCase } = packet.packetData;
  const dryRunShipping = isDryRunShippingReference(order.tracking_number);
  const itemDescription = (order.order_items || [])
    .map((item) => `${item.quantity || 0} x ${item.title || `Item ${item.id}`}`)
    .join("; ");
  const shippingAddress = [
    order.shipping_address_line1,
    order.shipping_address_line2,
    order.shipping_city,
    order.shipping_state,
    order.shipping_postal_code,
    order.shipping_country,
  ]
    .filter(Boolean)
    .join(", ");
  const summary = [
    `TCOS order ${order.id} dispute defense packet.`,
    `Case ${reviewCase.id}.`,
    `Order placed ${order.created_at || "date not saved"}.`,
    `Total ${Number(order.total || 0).toFixed(2)}.`,
    itemDescription ? `Products: ${itemDescription}.` : "Products are documented in the attached packet.",
    dryRunShipping
      ? "The saved order tracking reference is a TCOS dry-run simulation and is not being submitted as shipment evidence."
      : order.tracking_number
      ? `Shipment tracking ${order.tracking_number} via ${order.carrier || "saved carrier"}.`
      : "Tracking was not saved when this packet was generated.",
    `Terms acceptance: ${order.tos_accepted ? "recorded" : "not recorded"}.`,
    "The attached chronological PDF contains the order, buyer, shipment, terms/IP, ledger, payout-hold, and case-event evidence available to TCOS.",
  ].join(" ");

  return {
    customer_email_address: compact(order.customer_email),
    customer_name: compact(order.customer_name || order.shipping_name),
    customer_purchase_ip: compact(order.tos_ip_address),
    product_description: compact(itemDescription, 2000),
    shipping_address: compact(shippingAddress, 2000),
    shipping_carrier: dryRunShipping ? undefined : compact(order.carrier),
    shipping_date: dryRunShipping ? undefined : compact(order.shipped_at),
    shipping_tracking_number: dryRunShipping
      ? undefined
      : compact(order.tracking_number),
    uncategorized_file: stripeFileId,
    uncategorized_text: compact(summary, 19000),
  };
}

async function addCaseAuditEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  caseId: string;
  orderId: number;
  note: string;
  metadata: Record<string, unknown>;
}) {
  const { error } = await params.supabase
    .from("order_review_case_events")
    .insert({
      store_id: params.storeId,
      case_id: params.caseId,
      order_id: params.orderId,
      event_type: "case_note_added",
      note: params.note,
      actor_type: "platform_admin",
      metadata: params.metadata,
    });
  if (error) throw error;
}

export async function prepareStripeDisputeEvidence(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  caseId: string;
  dispute: Stripe.Dispute;
  stripeEventId?: string | null;
  stageOnStripe: boolean;
}) {
  const packet = await buildAndSaveOrderReviewCasePacket({
    supabase: params.supabase,
    storeId: params.storeId,
    caseId: params.caseId,
  });
  const { data: providerState, error: providerStateError } = await params.supabase
    .from("order_review_case_packets")
    .select(
      "id,provider_dispute_id,provider_evidence_status,provider_evidence_file_id,provider_evidence_submitted_at",
    )
    .eq("id", packet.packetId)
    .eq("store_id", params.storeId)
    .single();
  if (providerStateError || !providerState) {
    throw providerStateError || new Error("Dispute packet provider state was not found.");
  }

  const state = providerState as PacketProviderState;
  const observedStatus = evidenceStatus(params.dispute);
  const dueBy = stripeTimestamp(params.dispute.evidence_details?.due_by);
  const submittedAt =
    observedStatus === "submitted" && !state.provider_evidence_submitted_at
      ? new Date().toISOString()
      : state.provider_evidence_submitted_at;

  if (
    !params.stageOnStripe ||
    ["submitted", "won", "lost"].includes(observedStatus) ||
    state.provider_evidence_status === "submitted"
  ) {
    const nextStatus = ["won", "lost", "submitted"].includes(observedStatus)
      ? observedStatus
      : state.provider_evidence_status || observedStatus;
    const { error } = await params.supabase
      .from("order_review_case_packets")
      .update({
        provider_dispute_id: params.dispute.id,
        provider_evidence_status: nextStatus,
        provider_evidence_due_by: dueBy,
        provider_evidence_submitted_at: submittedAt,
        last_provider_event_id: params.stripeEventId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packet.packetId)
      .eq("store_id", params.storeId);
    if (error) throw error;

    return { packetId: packet.packetId, status: nextStatus, staged: false };
  }

  if (
    params.dispute.status !== "needs_response" ||
    params.dispute.evidence_details?.past_due
  ) {
    throw new Error("Stripe dispute evidence can no longer be staged for this case.");
  }

  try {
    let stripeFileId = state.provider_evidence_file_id;
    if (!stripeFileId) {
      const pdf = createEvidencePdf(packet.reportText);
      const stripeFile = await params.stripe.files.create(
        {
          purpose: "dispute_evidence",
          file: {
            data: pdf,
            name: orderReviewCasePacketFilename(
              packet.packetData.reviewCase.order_id,
              packet.packetData.reviewCase.id,
            ),
            type: "application/pdf",
          },
        },
        { idempotencyKey: `tcos-dispute-file-${params.dispute.id}` },
      );
      stripeFileId = stripeFile.id;
    }

    const evidence = evidencePayload(packet, stripeFileId);
    await params.stripe.disputes.update(
      params.dispute.id,
      {
        evidence,
        metadata: {
          tcos_case_id: packet.packetData.reviewCase.id,
          tcos_order_id: String(packet.packetData.reviewCase.order_id),
          tcos_packet_id: packet.packetId,
        },
        submit: false,
      },
      { idempotencyKey: `tcos-dispute-stage-${params.dispute.id}` },
    );

    const stagedAt = new Date().toISOString();
    const { error } = await params.supabase
      .from("order_review_case_packets")
      .update({
        provider_dispute_id: params.dispute.id,
        provider_evidence_status: "staged",
        provider_evidence_file_id: stripeFileId,
        provider_evidence_due_by: dueBy,
        provider_evidence_staged_at: stagedAt,
        provider_evidence_error: null,
        provider_evidence_payload: evidence,
        last_provider_event_id: params.stripeEventId || null,
        updated_at: stagedAt,
      })
      .eq("id", packet.packetId)
      .eq("store_id", params.storeId);
    if (error) throw error;

    await addCaseAuditEvent({
      supabase: params.supabase,
      storeId: params.storeId,
      caseId: params.caseId,
      orderId: packet.packetData.reviewCase.order_id,
      note: "TCOS generated the full dispute packet and staged editable evidence in Stripe without submitting it to the issuing bank.",
      metadata: {
        stripe_dispute_id: params.dispute.id,
        stripe_file_id: stripeFileId,
        evidence_status: "staged",
      },
    });

    return { packetId: packet.packetId, status: "staged" as const, staged: true };
  } catch (error: any) {
    await params.supabase
      .from("order_review_case_packets")
      .update({
        provider_dispute_id: params.dispute.id,
        provider_evidence_status: "failed",
        provider_evidence_due_by: dueBy,
        provider_evidence_error: String(error.message || "Stripe evidence staging failed").slice(0, 1000),
        last_provider_event_id: params.stripeEventId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", packet.packetId)
      .eq("store_id", params.storeId);
    throw error;
  }
}

export async function submitStripeDisputeEvidence(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  caseId: string;
}) {
  const { data: reviewCase, error: caseError } = await params.supabase
    .from("order_review_cases")
    .select("id,order_id,provider,provider_case_id")
    .eq("id", params.caseId)
    .eq("store_id", params.storeId)
    .single();
  if (caseError || !reviewCase?.provider_case_id || reviewCase.provider !== "stripe") {
    throw caseError || new Error("This case is not linked to a Stripe dispute.");
  }

  const { data: packet, error: packetError } = await params.supabase
    .from("order_review_case_packets")
    .select("id,provider_evidence_status,provider_evidence_file_id")
    .eq("case_id", params.caseId)
    .eq("store_id", params.storeId)
    .single();
  if (packetError || !packet) throw packetError || new Error("Dispute packet not found.");
  if (packet.provider_evidence_status === "submitted") {
    return { packetId: String(packet.id), status: "submitted" as const, replayed: true };
  }
  if (packet.provider_evidence_status !== "staged" || !packet.provider_evidence_file_id) {
    throw new Error("Stage and review the Stripe evidence before final submission.");
  }

  const disputeId = String(reviewCase.provider_case_id);
  const dispute = await params.stripe.disputes.retrieve(disputeId);
  if (dispute.status !== "needs_response" || dispute.evidence_details?.past_due) {
    throw new Error("Stripe is no longer accepting evidence for this dispute.");
  }

  await params.stripe.disputes.update(
    disputeId,
    { submit: true },
    { idempotencyKey: `tcos-dispute-submit-${disputeId}` },
  );
  const submittedAt = new Date().toISOString();
  const { error: updateError } = await params.supabase
    .from("order_review_case_packets")
    .update({
      provider_evidence_status: "submitted",
      provider_evidence_submitted_at: submittedAt,
      provider_evidence_error: null,
      updated_at: submittedAt,
    })
    .eq("id", packet.id)
    .eq("store_id", params.storeId);
  if (updateError) throw updateError;

  await addCaseAuditEvent({
    supabase: params.supabase,
    storeId: params.storeId,
    caseId: params.caseId,
    orderId: Number(reviewCase.order_id),
    note: "An authenticated TCOS administrator submitted the staged Stripe dispute evidence to the issuing bank.",
    metadata: { stripe_dispute_id: disputeId, evidence_status: "submitted" },
  });

  return { packetId: String(packet.id), status: "submitted" as const, replayed: false };
}
