import {
  buildLetterTrackDeliveryEvidenceSummary,
  evaluateLetterTrackSellerProtectionPaymentMetadataGate,
} from "../../../../../lib/lettertrack-delivery-evidence";
import { isDryRunShippingLabel as isDryRunShippingLabelRecord } from "../../../../../lib/shipping-dry-run";
import { shippingPurchaseAttemptAuditSentence } from "../../../../../lib/shipping-purchase-attempt-audit";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { evaluateUnder20SellerProtectionBuyerRefundMetadataGate } from "../../../../../lib/under20-seller-protection-claims";

export const dynamic = "force-dynamic";

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  provider_service: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_status: string | null;
  coverage_provider: string | null;
  coverage_status: string | null;
  coverage_amount: number | string | null;
  coverage_policy_id: string | null;
  postage_amount: number | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

type OrderRow = {
  id: number;
  customer_email: string | null;
  total: number | string | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
};

type TrackingEventRow = {
  id: string;
  order_id: number;
  shipping_label_id: string | null;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  event_type: string | null;
  event_status: string | null;
  message: string | null;
  raw_payload: Record<string, unknown> | null;
  occurred_at: string;
};

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
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ExceptionCsvRow = {
  priority_rank: number;
  exception_key: string;
  severity: "critical" | "warning" | "watch";
  exception_type: string;
  action_needed: string;
  order_id: number;
  customer_email: string;
  order_status: string;
  fulfillment_status: string;
  order_total: string;
  shipping_label_id: string;
  claim_id: string;
  provider: string;
  service: string;
  carrier: string;
  tracking_number: string;
  label_status: string;
  coverage_provider: string;
  coverage_status: string;
  coverage_policy_id: string;
  coverage_amount: string;
  postage_amount: string;
  dry_run_record: string;
  dry_run_warning: string;
  issue_detail: string;
  oldest_at: string;
  admin_url: string;
};

function shippingExceptionSummary(rows: ExceptionCsvRow[]) {
  const counts = rows.reduce(
    (summary, row) => {
      summary[row.severity] += 1;
      return summary;
    },
    { critical: 0, warning: 0, watch: 0 },
  );

  return {
    ...counts,
    total: rows.length,
    label: `critical:${counts.critical}; warning:${counts.warning}; watch:${counts.watch}`,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function money(value: number | string | null | undefined) {
  return Number(value || 0).toFixed(2);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isDryRunLabel(
  label: ShippingLabelRow | null | undefined,
  simulatedLabelIds: Set<string>,
) {
  if (!label) return false;

  return simulatedLabelIds.has(label.id) || isDryRunShippingLabelRecord(label);
}

function dryRunWarning(isDryRun: boolean) {
  return isDryRun
    ? "SIMULATED ONLY - no real postage, USPS label, or external Coverage policy was purchased."
    : "";
}

function exceptionKey(params: {
  exceptionType: string;
  orderId: number;
  labelId?: string | null;
  claimId?: string | null;
  eventId?: string | null;
}) {
  return [
    params.exceptionType,
    `order:${params.orderId}`,
    params.labelId ? `label:${params.labelId}` : null,
    params.claimId ? `claim:${params.claimId}` : null,
    params.eventId ? `event:${params.eventId}` : null,
  ]
    .filter(Boolean)
    .join("|");
}

function orderFor(ordersById: Map<number, OrderRow>, orderId: number) {
  return ordersById.get(orderId) || null;
}

function labelFor(
  labelsById: Map<string, ShippingLabelRow>,
  labelId: string | null,
) {
  return labelId ? labelsById.get(labelId) || null : null;
}

function csvResponse(rows: ExceptionCsvRow[]) {
  const summary = shippingExceptionSummary(rows);
  const headers = [
    "priority_rank",
    "exception_key",
    "severity",
    "exception_type",
    "action_needed",
    "order_id",
    "customer_email",
    "order_status",
    "fulfillment_status",
    "order_total",
    "shipping_label_id",
    "claim_id",
    "provider",
    "service",
    "carrier",
    "tracking_number",
    "label_status",
    "coverage_provider",
    "coverage_status",
    "coverage_policy_id",
    "coverage_amount",
    "postage_amount",
    "dry_run_record",
    "dry_run_warning",
    "issue_detail",
    "oldest_at",
    "admin_url",
  ] as const;
  const body = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\r\n");
  const exportedAt = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tcos-shipping-exceptions-${exportedAt}.csv"`,
      "Cache-Control": "no-store",
      "X-TCOS-Shipping-Exceptions-Rows": String(summary.total),
      "X-TCOS-Shipping-Exceptions-Critical": String(summary.critical),
      "X-TCOS-Shipping-Exceptions-Warning": String(summary.warning),
      "X-TCOS-Shipping-Exceptions-Watch": String(summary.watch),
      "X-TCOS-Shipping-Exceptions-Summary": summary.label,
    },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    const [labelsResult, eventsResult, claimsResult] = await Promise.all([
      supabase
        .from("order_shipping_labels")
        .select(
          "id,order_id,provider,provider_label_id,provider_shipment_id,provider_service,carrier,tracking_number,label_status,coverage_provider,coverage_status,coverage_amount,coverage_policy_id,postage_amount,metadata,created_at,updated_at",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("order_shipping_tracking_events")
        .select(
          "id,order_id,shipping_label_id,provider,carrier,tracking_number,event_type,event_status,message,raw_payload,occurred_at",
        )
        .eq("store_id", storeId)
        .order("occurred_at", { ascending: false })
        .limit(500),
      supabase
        .from("order_shipping_coverage_claims")
        .select(
          "id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_type,claim_amount,reason,metadata,created_at",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (labelsResult.error) throw labelsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    if (claimsResult.error) throw claimsResult.error;

    const labels = (labelsResult.data || []) as ShippingLabelRow[];
    const events = (eventsResult.data || []) as TrackingEventRow[];
    const claims = (claimsResult.data || []) as CoverageClaimRow[];
    const labelsById = new Map(labels.map((label) => [label.id, label]));
    const eventsByLabelId = new Map<string, TrackingEventRow[]>();
    for (const event of events) {
      if (!event.shipping_label_id) continue;
      const list = eventsByLabelId.get(event.shipping_label_id) || [];
      list.push(event);
      eventsByLabelId.set(event.shipping_label_id, list);
    }
    const simulatedLabelIds = new Set(
      events
        .filter(
          (event) =>
            event.event_type === "provider_purchase_simulated" &&
            event.shipping_label_id,
        )
        .map((event) => event.shipping_label_id as string),
    );
    const orderIds = Array.from(
      new Set([
        ...labels.map((row) => row.order_id),
        ...events.map((row) => row.order_id),
        ...claims.map((row) => row.order_id),
      ]),
    );
    const ordersResult =
      orderIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("orders")
            .select(
              "id,customer_email,total,status,fulfillment_status,shipping_name,tracking_number,carrier,created_at",
            )
            .eq("store_id", storeId)
            .in("id", orderIds);

    if (ordersResult.error) throw ordersResult.error;

    const ordersById = new Map(
      ((ordersResult.data || []) as OrderRow[]).map((order) => [
        order.id,
        order,
      ]),
    );
    const fulfilledStatuses = new Set([
      "shipped",
      "delivered",
      "fulfilled",
      "complete",
      "completed",
    ]);
    const purchasedLabels = labels.filter((row) =>
      ["purchased", "printed"].includes(row.label_status || ""),
    );
    const voidedLabels = labels.filter((row) => row.label_status === "voided");
    const rows: ExceptionCsvRow[] = [];

    function pushLabelException(params: {
      severity: ExceptionCsvRow["severity"];
      exceptionType: string;
      actionNeeded: string;
      label: ShippingLabelRow;
      issueDetail: string;
      oldestAt: string;
    }) {
      const order = orderFor(ordersById, params.label.order_id);
      const dryRun = isDryRunLabel(params.label, simulatedLabelIds);
      rows.push({
        priority_rank: 0,
        exception_key: exceptionKey({
          exceptionType: params.exceptionType,
          orderId: params.label.order_id,
          labelId: params.label.id,
        }),
        severity: params.severity,
        exception_type: params.exceptionType,
        action_needed: params.actionNeeded,
        order_id: params.label.order_id,
        customer_email: order?.customer_email || "",
        order_status: order?.status || "",
        fulfillment_status: order?.fulfillment_status || "",
        order_total: money(order?.total),
        shipping_label_id: params.label.id,
        claim_id: "",
        provider: params.label.provider || "",
        service: params.label.provider_service || order?.shipping_name || "",
        carrier: params.label.carrier || order?.carrier || "",
        tracking_number:
          params.label.tracking_number || order?.tracking_number || "",
        label_status: params.label.label_status || "",
        coverage_provider: params.label.coverage_provider || "",
        coverage_status: params.label.coverage_status || "",
        coverage_policy_id: params.label.coverage_policy_id || "",
        coverage_amount: money(params.label.coverage_amount),
        postage_amount: money(params.label.postage_amount),
        dry_run_record: dryRun ? "yes" : "no",
        dry_run_warning: dryRunWarning(dryRun),
        issue_detail: params.issueDetail,
        oldest_at: params.oldestAt,
        admin_url: `${url.origin}/admin/orders/${params.label.order_id}`,
      });
    }

    for (const event of events.filter(
      (row) => row.event_type === "provider_purchase_blocked",
    )) {
      const order = orderFor(ordersById, event.order_id);
      const label = labelFor(labelsById, event.shipping_label_id);
      const dryRun = isDryRunLabel(label, simulatedLabelIds);
      rows.push({
        priority_rank: 0,
        exception_key: exceptionKey({
          exceptionType: "blocked_purchase_attempt",
          orderId: event.order_id,
          labelId: event.shipping_label_id,
          eventId: event.id,
        }),
        severity: "critical",
        exception_type: "blocked_purchase_attempt",
        action_needed: "Fix provider setup or record an external label.",
        order_id: event.order_id,
        customer_email: order?.customer_email || "",
        order_status: order?.status || "",
        fulfillment_status: order?.fulfillment_status || "",
        order_total: money(order?.total),
        shipping_label_id: event.shipping_label_id || "",
        claim_id: "",
        provider: event.provider || label?.provider || "",
        service: label?.provider_service || order?.shipping_name || "",
        carrier: event.carrier || label?.carrier || order?.carrier || "",
        tracking_number:
          event.tracking_number ||
          label?.tracking_number ||
          order?.tracking_number ||
          "",
        label_status: label?.label_status || "",
        coverage_provider: label?.coverage_provider || "",
        coverage_status: label?.coverage_status || "",
        coverage_policy_id: label?.coverage_policy_id || "",
        coverage_amount: money(label?.coverage_amount),
        postage_amount: money(label?.postage_amount),
        dry_run_record: dryRun ? "yes" : "no",
        dry_run_warning: dryRunWarning(dryRun),
        issue_detail: `${event.message || "Provider purchase was blocked."}${shippingPurchaseAttemptAuditSentence(event.raw_payload)}`,
        oldest_at: event.occurred_at,
        admin_url: `${url.origin}/admin/orders/${event.order_id}`,
      });
    }

    for (const label of purchasedLabels) {
      const order = orderFor(ordersById, label.order_id);
      if (!label.tracking_number && !order?.tracking_number) {
        pushLabelException({
          severity: "critical",
          exceptionType: "tracking_missing",
          actionNeeded: "Save tracking number or USPS IMb.",
          label,
          issueDetail:
            "Label is purchased or printed, but tracking is not saved.",
          oldestAt: label.updated_at || label.created_at,
        });
      }

      if (label.coverage_status !== "covered" || !label.coverage_policy_id) {
        pushLabelException({
          severity: "warning",
          exceptionType: "coverage_policy_missing",
          actionNeeded: "Record Coverage policy details.",
          label,
          issueDetail:
            "Coverage was expected, but policy details are incomplete.",
          oldestAt: label.updated_at || label.created_at,
        });
      }

      const hasTracking = Boolean(label.tracking_number || order?.tracking_number);
      const isAlreadyFulfilled = fulfilledStatuses.has(
        (order?.fulfillment_status || "").toLowerCase(),
      );
      if (hasTracking && !isAlreadyFulfilled) {
        pushLabelException({
          severity: "warning",
          exceptionType: "ready_to_mark_shipped",
          actionNeeded: "Mark the order shipped.",
          label,
          issueDetail:
            "Tracking exists, but the order is not marked fulfilled or shipped.",
          oldestAt: label.updated_at || label.created_at,
        });
      }
    }

    for (const label of voidedLabels) {
      const hasNewerActiveLabel = labels.some(
        (candidate) =>
          candidate.order_id === label.order_id &&
          candidate.id !== label.id &&
          candidate.created_at > label.created_at &&
          !["voided", "failed"].includes(candidate.label_status || ""),
      );

      if (!hasNewerActiveLabel) {
        pushLabelException({
          severity: "critical",
          exceptionType: "replacement_needed",
          actionNeeded: "Create or record a replacement label.",
          label,
          issueDetail:
            "Label was voided and no newer active replacement is recorded.",
          oldestAt: label.updated_at || label.created_at,
        });
      }
    }

    for (const claim of claims.filter(
      (row) => row.claim_status === "approved",
    )) {
      const under20Claim = recordValue(
        recordValue(claim.metadata).under_20_seller_protection_claim,
      );

      if (under20Claim.eligible !== true) continue;

      const order = orderFor(ordersById, claim.order_id);
      const label = labelFor(labelsById, claim.shipping_label_id);
      const refundGate = evaluateUnder20SellerProtectionBuyerRefundMetadataGate({
        metadata: claim.metadata,
      });

      if (!refundGate.allowed) {
        const dryRun = isDryRunLabel(label, simulatedLabelIds);
        rows.push({
          priority_rank: 0,
          exception_key: exceptionKey({
            exceptionType: "seller_protection_refund_proof_missing",
            orderId: claim.order_id,
            labelId: claim.shipping_label_id,
            claimId: claim.id,
          }),
          severity: "warning",
          exception_type: "seller_protection_refund_proof_missing",
          action_needed:
            "Document buyer/customer refund evidence or a refund reference before Mark Paid.",
          order_id: claim.order_id,
          customer_email: order?.customer_email || "",
          order_status: order?.status || "",
          fulfillment_status: order?.fulfillment_status || "",
          order_total: money(order?.total),
          shipping_label_id: claim.shipping_label_id || "",
          claim_id: claim.id,
          provider: claim.provider || label?.provider || "",
          service: label?.provider_service || order?.shipping_name || "",
          carrier: label?.carrier || order?.carrier || "",
          tracking_number:
            label?.tracking_number || order?.tracking_number || "",
          label_status: label?.label_status || "",
          coverage_provider: label?.coverage_provider || claim.provider || "",
          coverage_status: label?.coverage_status || "",
          coverage_policy_id: label?.coverage_policy_id || "",
          coverage_amount: money(label?.coverage_amount || claim.claim_amount),
          postage_amount: money(label?.postage_amount),
          dry_run_record: dryRun ? "yes" : "no",
          dry_run_warning: dryRunWarning(dryRun),
          issue_detail: refundGate.reason,
          oldest_at: claim.created_at,
          admin_url: `${url.origin}/admin/orders/${claim.order_id}`,
        });
      }

      const liveLetterTrackEvidence = buildLetterTrackDeliveryEvidenceSummary(
        claim.shipping_label_id
          ? eventsByLabelId.get(claim.shipping_label_id) || []
          : [],
      );
      const gate = evaluateLetterTrackSellerProtectionPaymentMetadataGate({
        evidence: liveLetterTrackEvidence,
        metadata: claim.metadata,
      });

      if (gate.allowed) continue;

      const dryRun = isDryRunLabel(label, simulatedLabelIds);
      rows.push({
        priority_rank: 0,
        exception_key: exceptionKey({
          exceptionType: "seller_protection_payout_blocked",
          orderId: claim.order_id,
          labelId: claim.shipping_label_id,
          claimId: claim.id,
        }),
        severity: liveLetterTrackEvidence.deliveredEvidencePresent
          ? "critical"
          : "warning",
        exception_type: "seller_protection_payout_blocked",
        action_needed:
          "Record LetterTrack not-delivered evidence, deny/cancel the claim, or add a current/saved explicit override note before Mark Paid.",
        order_id: claim.order_id,
        customer_email: order?.customer_email || "",
        order_status: order?.status || "",
        fulfillment_status: order?.fulfillment_status || "",
        order_total: money(order?.total),
        shipping_label_id: claim.shipping_label_id || "",
        claim_id: claim.id,
        provider: claim.provider || label?.provider || "",
        service: label?.provider_service || order?.shipping_name || "",
        carrier: label?.carrier || order?.carrier || "",
        tracking_number:
          liveLetterTrackEvidence.latestTrackingNumber ||
          label?.tracking_number ||
          order?.tracking_number ||
          "",
        label_status: label?.label_status || "",
        coverage_provider: label?.coverage_provider || claim.provider || "",
        coverage_status: label?.coverage_status || "",
        coverage_policy_id: label?.coverage_policy_id || "",
        coverage_amount: money(label?.coverage_amount || claim.claim_amount),
        postage_amount: money(label?.postage_amount),
        dry_run_record: dryRun ? "yes" : "no",
        dry_run_warning: dryRunWarning(dryRun),
        issue_detail: `${gate.reason} Latest LetterTrack status: ${
          liveLetterTrackEvidence.latestStatus || "not recorded"
        }.`,
        oldest_at: claim.created_at,
        admin_url: `${url.origin}/admin/orders/${claim.order_id}`,
      });
    }

    for (const claim of claims.filter(
      (row) =>
        !["paid", "denied", "cancelled"].includes(
          row.claim_status || "draft",
        ),
    )) {
      const order = orderFor(ordersById, claim.order_id);
      const label = labelFor(labelsById, claim.shipping_label_id);
      const dryRun = isDryRunLabel(label, simulatedLabelIds);
      rows.push({
        priority_rank: 0,
        exception_key: exceptionKey({
          exceptionType: "open_coverage_claim",
          orderId: claim.order_id,
          labelId: claim.shipping_label_id,
          claimId: claim.id,
        }),
        severity: "watch",
        exception_type: "open_coverage_claim",
        action_needed: "Review claim evidence, status, payout, or closure.",
        order_id: claim.order_id,
        customer_email: order?.customer_email || "",
        order_status: order?.status || "",
        fulfillment_status: order?.fulfillment_status || "",
        order_total: money(order?.total),
        shipping_label_id: claim.shipping_label_id || "",
        claim_id: claim.id,
        provider: claim.provider || label?.provider || "",
        service: label?.provider_service || order?.shipping_name || "",
        carrier: label?.carrier || order?.carrier || "",
        tracking_number:
          label?.tracking_number || order?.tracking_number || "",
        label_status: label?.label_status || "",
        coverage_provider: label?.coverage_provider || claim.provider || "",
        coverage_status: label?.coverage_status || "",
        coverage_policy_id: label?.coverage_policy_id || "",
        coverage_amount: money(label?.coverage_amount || claim.claim_amount),
        postage_amount: money(label?.postage_amount),
        dry_run_record: dryRun ? "yes" : "no",
        dry_run_warning: dryRunWarning(dryRun),
        issue_detail: claim.reason || claim.claim_type || "Coverage claim is open.",
        oldest_at: claim.created_at,
        admin_url: `${url.origin}/admin/orders/${claim.order_id}`,
      });
    }

    rows.sort((a, b) => {
      const severityRank = { critical: 0, warning: 1, watch: 2 };
      const severityDiff = severityRank[a.severity] - severityRank[b.severity];
      if (severityDiff !== 0) return severityDiff;

      return new Date(a.oldest_at).getTime() - new Date(b.oldest_at).getTime();
    });
    rows.forEach((row, index) => {
      row.priority_rank = index + 1;
    });

    return csvResponse(rows);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not export shipping exceptions." },
      { status: 500 },
    );
  }
}
