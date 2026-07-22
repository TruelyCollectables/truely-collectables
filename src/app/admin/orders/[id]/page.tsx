import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { getAccountProfilesByIds } from "../../../../lib/account-profiles";
import { isOrderReviewStatus } from "../../../../lib/order-status";
import { isDryRunShippingLabel as isDryRunShippingLabelRecord } from "../../../../lib/shipping-dry-run";
import { buildShippingPurchaseAttemptAudit } from "../../../../lib/shipping-purchase-attempt-audit";
import { getShippingProviderReadiness } from "../../../../lib/shipping-provider-readiness";
import {
  buildLetterTrackDeliveryEvidenceSummary,
  evaluateLetterTrackSellerProtectionPaymentMetadataGate,
} from "../../../../lib/lettertrack-delivery-evidence";
import Link from "next/link";
import PayoutLedgerActions from "../../seller-payouts/PayoutLedgerActions";
import OrderReviewCasesPanel, {
  type AdminOrderReviewCase,
  type AdminOrderReviewCaseEvent,
  type SellerCaseOption,
} from "./OrderReviewCasesPanel";
import ShippingLabelActions from "./ShippingLabelActions";
import ShippingClaimActions from "../../shipping/ShippingClaimActions";
import TrackingForm from "./TrackingForm";
import type { ReactNode } from "react";

type OrderItem = {
  id: number;
  seller_account_id?: string | null;
  title: string;
  quantity: number;
  price: number;
};

type Order = {
  id: number;
  account_id?: string | null;
  created_at: string;
  customer_email: string | null;
  customer_name?: string | null;
  total: number;
  status: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | null;
  subtotal: number | null;
  item_count: number | null;
  contains_seller_items?: boolean | null;
  seller_item_count?: number | null;
  store_item_count?: number | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  discount_amount?: number | null;
  discount_code?: string | null;
  customer_notes?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
  tos_accepted?: boolean | null;
  tos_version?: string | null;
  tos_accepted_at?: string | null;
  tos_acceptance_event_id?: string | null;
  tos_ip_address?: string | null;
  tos_user_agent?: string | null;
  tos_ip_risk?: string | null;
  tos_ip_block_reason?: string | null;
  order_items?: OrderItem[];
};

type EvidenceReport = {
  id: string;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
  updated_at: string | null;
};

type SellerPayoutLedgerEntry = {
  id: string;
  seller_account_id: string;
  order_item_id: number;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
  created_at: string;
};

type PlatformFeeLedgerEntry = {
  id: string;
  order_item_id: number;
  seller_account_id: string | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  fee_status: string | null;
  created_at: string;
};

type ShippingLabel = {
  id: string;
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  provider_service: string | null;
  service_level: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_url: string | null;
  label_pdf_url: string | null;
  postage_amount: number | string | null;
  currency: string | null;
  label_status: string | null;
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
  created_at: string;
  updated_at: string | null;
};

type ShippingTrackingEvent = {
  id: string;
  shipping_label_id: string | null;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  event_type: string | null;
  event_code: string | null;
  event_status: string | null;
  message: string | null;
  location: string | null;
  occurred_at: string;
  created_at: string;
};

type ShippingCoverageClaim = {
  id: string;
  shipping_label_id: string | null;
  provider: string | null;
  provider_claim_id: string | null;
  claim_status: string | null;
  claim_type: string | null;
  claim_amount: number | string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function statusTone(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "paid" || normalized === "active" || normalized === "shipped") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (normalized.includes("review") || normalized.includes("hold")) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (normalized === "refunded" || normalized === "failed" || normalized === "cancelled") {
    return "border-red-200 bg-red-50 text-red-950";
  }

  return "border-neutral-200 bg-white text-neutral-950";
}

function orderCommandPosture({
  activeDryRunShippingLabel,
  fulfillmentStatus,
  needsReview,
  paymentStatus,
}: {
  activeDryRunShippingLabel: boolean;
  fulfillmentStatus: string | null;
  needsReview: boolean;
  paymentStatus: string | null;
}): {
  detail: string;
  label: string;
  tone: "neutral" | "emerald" | "sky" | "amber" | "rose";
} {
  const payment = String(paymentStatus || "").toLowerCase();
  const fulfillment = String(fulfillmentStatus || "").toLowerCase();

  if (activeDryRunShippingLabel) {
    return {
      detail: "Replace simulated shipping proof before treating this order as shipped.",
      label: "Dry-run proof attached",
      tone: "rose",
    };
  }

  if (needsReview) {
    return {
      detail: "Verify shipping evidence, inventory, and payment before release.",
      label: "Review hold",
      tone: "amber",
    };
  }

  if (fulfillment === "shipped") {
    return {
      detail: "Fulfillment is marked shipped; keep evidence and tracking current.",
      label: "Shipped",
      tone: "emerald",
    };
  }

  if (payment === "paid") {
    return {
      detail: "Paid order is ready for fulfillment checks and shipping proof.",
      label: "Ready to fulfill",
      tone: "sky",
    };
  }

  return {
    detail: "Payment or fulfillment status needs operator review.",
    label: "Needs review",
    tone: "neutral",
  };
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

function safeErrorMessage(error: { message?: string } | string | null | undefined) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Unknown database error.";

  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

function OrderMetric({
  label: metricLabel,
  tone = "border-neutral-200 bg-white text-neutral-950",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tone}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
        {metricLabel}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function OrderHeaderStat({
  detail,
  label: statLabel,
  tone = "neutral",
  value,
}: {
  detail: string;
  label: string;
  tone?: "neutral" | "emerald" | "sky" | "amber" | "rose";
  value: string;
}) {
  const accentClassName =
    tone === "emerald"
      ? "text-emerald-200"
      : tone === "sky"
        ? "text-sky-200"
        : tone === "amber"
          ? "text-amber-200"
          : tone === "rose"
            ? "text-rose-200"
            : "text-neutral-200";

  return (
    <div className="bg-neutral-950/80 p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-400">
        {statLabel}
      </p>
      <p className={`mt-2 text-2xl font-black ${accentClassName}`}>{value}</p>
      <p className="mt-1 text-xs font-bold leading-5 text-neutral-400">{detail}</p>
    </div>
  );
}

function AdminSection({
  eyebrow,
  title,
  detail,
  children,
  tone = "border-neutral-200 bg-white",
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <section className={`rounded-[2rem] border p-6 shadow-sm ${tone}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow ? (
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-2xl font-black">{title}</h2>
          {detail ? (
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoTile({
  label: tileLabel,
  value,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-neutral-50 p-4 ${
        wide ? "md:col-span-2" : ""
      }`}
    >
      <dt className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
        {tileLabel}
      </dt>
      <dd className="mt-1 break-words text-sm font-bold text-neutral-950">
        {value}
      </dd>
    </div>
  );
}

function UnavailableNotice({
  title,
  detail,
  error,
  tone = "amber",
}: {
  title: string;
  detail: string;
  error?: { message?: string } | string | null;
  tone?: "amber" | "red";
}) {
  const styles =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-950"
      : "border-amber-200 bg-amber-50 text-amber-950";

  return (
    <div className={`rounded-2xl border p-4 text-sm ${styles}`}>
      <p className="font-black">{title}</p>
      <p className="mt-1 font-semibold leading-6">{detail}</p>
      {error ? (
        <p className="mt-2 rounded-xl border border-current/20 bg-white/60 px-3 py-2 text-xs font-bold">
          Diagnostic: {safeErrorMessage(error)}
        </p>
      ) : null}
    </div>
  );
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function isDryRunShippingLabel(
  shippingLabel: ShippingLabel,
  shippingTrackingEvents: ShippingTrackingEvent[],
) {
  return (
    isDryRunShippingLabelRecord(shippingLabel) ||
    shippingTrackingEvents.some(
      (event) =>
        event.shipping_label_id === shippingLabel.id &&
        event.event_type === "provider_purchase_simulated",
    )
  );
}

function standardEnvelopePolicyNote(shippingLabel: ShippingLabel) {
  const reason =
    metadataText(shippingLabel.metadata, "shipping_policy_reason") ||
    metadataText(shippingLabel.metadata, "standard_envelope_reason");
  const estimatedOz = metadataNumber(
    shippingLabel.metadata,
    "standard_envelope_estimated_oz",
  );

  if (
    !reason &&
    shippingLabel.requested_shipping_method ===
      shippingLabel.resolved_shipping_method
  ) {
    return null;
  }

  const transition =
    shippingLabel.requested_shipping_method &&
    shippingLabel.resolved_shipping_method
      ? `${label(shippingLabel.requested_shipping_method)} -> ${label(
          shippingLabel.resolved_shipping_method,
        )}`
      : null;

  return [
    transition,
    estimatedOz ? `${estimatedOz} estimated oz` : null,
    reason,
  ]
    .filter(Boolean)
    .join(" / ");
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function shippingAdapterProfileDetails(
  metadata: Record<string, unknown> | null | undefined,
) {
  const profile = metadataRecord(metadata, "shipping_adapter_profile");

  if (!profile) return null;

  return {
    adapter: metadataText(profile, "adapterKey") || "adapter",
    status: metadataText(profile, "adapterStatus") || "unknown",
    provider: metadataText(profile, "provider") || "Provider pending",
    service: metadataText(profile, "providerService") || "Service pending",
    carrier: metadataText(profile, "carrier") || "Carrier pending",
    purchaseMode: metadataText(profile, "purchaseMode") || "dry_run",
    missingCredentials: [
      ...stringList(profile.missingCredentialKeys),
      ...stringList(profile.missingCoverageCredentialKeys),
    ],
    liveBlockReason: metadataText(profile, "liveBlockReason"),
  };
}

export default async function AdminOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ shippingAction?: string }>;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const shippingAction = String(resolvedSearchParams.shippingAction || "").trim();
  const storeId = getActiveStoreId();

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      order_items (
        id,
        seller_account_id,
        title,
        quantity,
        price
      )
    `
    )
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (error || !order) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e0f2fe,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white/95 p-6 shadow-sm ring-1 ring-red-950/5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Order detail
          </p>
          <h1 className="mt-2 text-3xl font-black">Order not found</h1>
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950">
            {error
              ? safeErrorMessage(error)
              : "This order no longer exists in the active store."}
          </p>
          <Link
            href="/admin/orders"
            className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
          >
            Back to fulfillment center
          </Link>
        </section>
      </main>
    );
  }

  const typedOrder = order as Order;
  const sellerAccountIds = Array.from(
    new Set(
      (typedOrder.order_items || [])
        .map((item) => item.seller_account_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const accountProfiles = await getAccountProfilesByIds([
    typedOrder.account_id,
    ...sellerAccountIds,
  ]);
  const accountProfile = typedOrder.account_id
    ? accountProfiles.get(typedOrder.account_id)
    : undefined;
  const sellerOptions: SellerCaseOption[] = sellerAccountIds.map((sellerId) => {
    const profile = accountProfiles.get(sellerId);

    return {
      id: sellerId,
      label: profile?.email || profile?.display_name || sellerId,
    };
  });
  const { data: orderReviewCasesData, error: orderReviewCasesError } =
    await supabase
      .from("order_review_cases")
      .select(
        `
        id,
        seller_account_id,
        case_type,
        status,
        severity,
        title,
        description,
        hold_seller_payouts,
        hold_order_fulfillment,
        outcome_summary,
        opened_at,
        closed_at,
        updated_at
      `,
      )
      .eq("order_id", typedOrder.id)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
  const orderReviewCases = orderReviewCasesError
    ? []
    : ((orderReviewCasesData || []) as AdminOrderReviewCase[]);
  const orderReviewCaseIds = orderReviewCases.map((reviewCase) => reviewCase.id);
  const { data: orderReviewCaseEventsData, error: orderReviewCaseEventsError } =
    orderReviewCaseIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("order_review_case_events")
          .select(
            `
            id,
            case_id,
            event_type,
            previous_status,
            new_status,
            note,
            ip_address,
            identity_risk,
            created_at
          `,
          )
          .in("case_id", orderReviewCaseIds)
          .eq("store_id", storeId)
          .order("created_at", { ascending: false });
  const orderReviewCaseEvents =
    (orderReviewCaseEventsData || []) as AdminOrderReviewCaseEvent[];
  const { data: evidenceReports, error: evidenceError } = await supabase
    .from("transaction_evidence_reports")
    .select(
      `
      id,
      status,
      emailed_to,
      email_sent_at,
      email_error,
      created_at,
      updated_at
    `
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const latestEvidence = ((evidenceReports || []) as EvidenceReport[])[0];
  const { data: payoutLedgerEntries, error: payoutLedgerError } = await supabase
    .from("seller_payout_ledger_entries")
    .select(
      `
      id,
      seller_account_id,
      order_item_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      seller_payable_amount,
      payout_status,
      created_at
    `,
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const sellerPayoutLedger =
    (payoutLedgerEntries || []) as SellerPayoutLedgerEntry[];
  const sellerPayoutTotal = sellerPayoutLedger.reduce(
    (sum, entry) => sum + Number(entry.seller_payable_amount || 0),
    0,
  );
  const platformFeeTotal = sellerPayoutLedger.reduce(
    (sum, entry) => sum + Number(entry.platform_fee_amount || 0),
    0,
  );
  const { data: platformFeeLedgerEntries, error: platformFeeLedgerError } =
    await supabase
    .from("platform_fee_ledger_entries")
    .select(
      `
      id,
      order_item_id,
      seller_account_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      fee_status,
      created_at
    `,
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const platformFeeLedger = platformFeeLedgerError
    ? []
    : ((platformFeeLedgerEntries || []) as PlatformFeeLedgerEntry[]);
  const allSiteRakeTotal = platformFeeLedger.reduce(
    (sum, entry) => sum + Number(entry.platform_fee_amount || 0),
    0,
  );
  const shippingProviderReadiness = getShippingProviderReadiness();
  const { data: shippingLabelsData, error: shippingLabelsError } =
    await supabase
      .from("order_shipping_labels")
      .select(
        `
        id,
        provider,
        provider_label_id,
        provider_shipment_id,
        provider_service,
        service_level,
        carrier,
        tracking_number,
        label_url,
        label_pdf_url,
        postage_amount,
        currency,
        label_status,
        requested_shipping_method,
        resolved_shipping_method,
        coverage_provider,
        coverage_required,
        coverage_status,
        coverage_amount,
        coverage_policy_id,
        coverage_claim_id,
        coverage_claim_status,
        purchased_at,
        printed_at,
        voided_at,
        metadata,
        created_at,
        updated_at
      `,
      )
      .eq("order_id", typedOrder.id)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
  const shippingLabels = shippingLabelsError
    ? []
    : ((shippingLabelsData || []) as ShippingLabel[]);
  const shippingLabelIds = shippingLabels.map((row) => row.id);
  const { data: shippingTrackingEventsData, error: shippingTrackingEventsError } =
    await supabase
      .from("order_shipping_tracking_events")
      .select(
        `
        id,
        shipping_label_id,
        provider,
        carrier,
        tracking_number,
        event_type,
        event_code,
        event_status,
        message,
        location,
        occurred_at,
        created_at
      `,
      )
      .eq("order_id", typedOrder.id)
      .eq("store_id", storeId)
      .order("occurred_at", { ascending: false })
      .limit(100);
  const shippingTrackingEvents = shippingTrackingEventsError
    ? []
    : ((shippingTrackingEventsData || []) as ShippingTrackingEvent[]);
  const shippingTrackingEventsByLabelId = new Map<string, ShippingTrackingEvent[]>();
  for (const event of shippingTrackingEvents) {
    if (!event.shipping_label_id) continue;
    const list = shippingTrackingEventsByLabelId.get(event.shipping_label_id) || [];
    list.push(event);
    shippingTrackingEventsByLabelId.set(event.shipping_label_id, list);
  }
  const { data: shippingCoverageClaimsData, error: shippingCoverageClaimsError } =
    await supabase
      .from("order_shipping_coverage_claims")
      .select(
        `
        id,
        shipping_label_id,
        provider,
        provider_claim_id,
        claim_status,
        claim_type,
        claim_amount,
        reason,
        metadata,
        submitted_at,
        resolved_at,
        created_at
      `,
      )
      .eq("order_id", typedOrder.id)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
  const shippingCoverageClaims = shippingCoverageClaimsError
    ? []
    : ((shippingCoverageClaimsData || []) as ShippingCoverageClaim[]);
  const evidenceUnavailable = Boolean(evidenceError);
  const payoutLedgerUnavailable = Boolean(payoutLedgerError);
  const platformFeeLedgerUnavailable = Boolean(platformFeeLedgerError);
  const shippingLabelsUnavailable = Boolean(shippingLabelsError);
  const shippingTrackingEventsUnavailable = Boolean(
    shippingTrackingEventsError,
  );
  const shippingCoverageClaimsUnavailable = Boolean(shippingCoverageClaimsError);

  const itemsTotal =
    typedOrder.order_items?.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    ) || Number(typedOrder.subtotal || 0);

  const discountAmount = Number(typedOrder.discount_amount || 0);
  const shippingPaid = Number(typedOrder.shipping_amount || 0);
  const totalPaid = Number(typedOrder.total || 0);
  const needsReview = isOrderReviewStatus(
    typedOrder.status,
    typedOrder.fulfillment_status,
  );
  const reviewMessage =
    "Review hold: verify shipping evidence, inventory, and payment details before marking this order shipped.";
  const activeShippingLabel = shippingLabels.find(
    (shippingLabel) =>
      !["voided", "failed"].includes(shippingLabel.label_status || ""),
  );
  const activeDryRunShippingLabel = Boolean(
    typedOrder.tracking_number?.includes("TCOS-DRYRUN") ||
      (activeShippingLabel &&
        isDryRunShippingLabel(activeShippingLabel, shippingTrackingEvents)),
  );
  const orderPosture = orderCommandPosture({
    activeDryRunShippingLabel,
    fulfillmentStatus: typedOrder.fulfillment_status,
    needsReview,
    paymentStatus: typedOrder.status,
  });
  const customerLabel =
    typedOrder.customer_email || typedOrder.customer_name || "Customer not captured";
  const itemCount = Number(typedOrder.item_count || typedOrder.order_items?.length || 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#e0f2fe,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 shadow-2xl shadow-neutral-950/10">
          <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.28),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-4xl">
                <Link
                  href="/admin/orders"
                  className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
                >
                  ← Back to fulfillment center
                </Link>
                <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-sky-300">
                  Order command desk
                </p>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-white lg:text-5xl">
                  Order #{typedOrder.id}
                </h1>
                <p className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-300">
                  <span>Created {new Date(typedOrder.created_at).toLocaleString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>{customerLabel}</span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                    {orderPosture.label}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/admin/orders/${typedOrder.id}/packing-slip`}
                  className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-sm font-black text-sky-100 shadow-sm transition hover:bg-sky-300/20"
                >
                  Packing slip
                </Link>
                <Link
                  href="/admin/files"
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
                >
                  Evidence files
                </Link>
                <Link
                  href="/admin/orders"
                  className="rounded-full bg-white px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-sky-50"
                >
                  Orders
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            <OrderHeaderStat
              label="Payment"
              value={label(typedOrder.status)}
              detail="Checkout payment state for this order."
              tone={typedOrder.status === "paid" ? "emerald" : orderPosture.tone}
            />
            <OrderHeaderStat
              label="Fulfillment"
              value={label(typedOrder.fulfillment_status)}
              detail="Shipment and handling state for the operator."
              tone={orderPosture.tone}
            />
            <OrderHeaderStat
              label="Operator posture"
              value={orderPosture.label}
              detail={orderPosture.detail}
              tone={orderPosture.tone}
            />
            <OrderHeaderStat
              label="Total paid"
              value={money(totalPaid)}
              detail={`${itemCount} ${itemCount === 1 ? "item" : "items"} in this checkout.`}
              tone="sky"
            />
          </div>
        </section>

      {needsReview ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
          <h2 className="text-xl font-black">Order needs review</h2>
          <p className="mt-2 text-sm font-semibold">{reviewMessage}</p>
        </section>
      ) : null}

      {activeDryRunShippingLabel ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
          <h2 className="text-xl font-black">Dry-run shipping is still attached</h2>
          <p className="mt-2 text-sm font-semibold">
            Replace the simulated label/tracking with a real provider label before
            treating this order as shipped.
          </p>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <OrderMetric
          label="Payment"
          value={label(typedOrder.status)}
          tone={statusTone(typedOrder.status)}
        />
        <OrderMetric
          label="Fulfillment"
          value={label(typedOrder.fulfillment_status)}
          tone={statusTone(typedOrder.fulfillment_status)}
        />
        <OrderMetric label="Items total" value={money(itemsTotal)} />
        <OrderMetric label="Total paid" value={money(totalPaid)} />
      </section>

      {platformFeeLedgerUnavailable ? (
        <AdminSection
          eyebrow="Platform revenue"
          title="Dag Danky Holdings LLC Rake"
          detail="Calculated from this TCOS website checkout order only, using each order item plus allocated buyer-paid shipping."
        >
          <UnavailableNotice
            title="Platform fee ledger unavailable."
            detail="Platform fee storage did not load for this order, so this cockpit cannot prove whether TCOS checkout fee rows exist or whether the rake total is complete."
            error={platformFeeLedgerError}
          />
        </AdminSection>
      ) : platformFeeLedger.length > 0 ? (
        <AdminSection
          eyebrow="Platform revenue"
          title="Dag Danky Holdings LLC Rake"
          detail="Calculated from this TCOS website checkout order only, using each order item plus allocated buyer-paid shipping."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-4 text-white">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-300">
              8% Platform Rake Total
            </p>
            <p className="mt-2 text-3xl font-black">{money(allSiteRakeTotal)}</p>
          </div>

          <div className="mt-4 space-y-3">
            {platformFeeLedger.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-bold">
                      Order Item #{entry.order_item_id}
                    </p>
                    <p className="text-sm font-semibold text-neutral-600">
                      {entry.seller_account_id
                        ? `Outside seller ${entry.seller_account_id}`
                        : "Store inventory"}
                    </p>
                  </div>

                  <p className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-black">
                    Rate{" "}
                    {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}%
                  </p>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <InfoTile label="Gross" value={money(Number(entry.gross_item_amount || 0))} />
                  <InfoTile label="Shipping Basis" value={money(Number(entry.shipping_allocated_amount || 0))} />
                  <InfoTile label="Total Basis" value={money(Number(entry.total_basis_amount || 0))} />
                  <InfoTile label="Dag Danky Holdings LLC Fee" value={money(Number(entry.platform_fee_amount || 0))} />
                </dl>
              </div>
            ))}
          </div>
        </AdminSection>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">
            Seller routing
          </p>
          <h2 className="mt-1 text-xl font-black">Mixed fulfillment order</h2>
          <p className="mt-2 text-sm font-semibold leading-6">
            This order contains {typedOrder.seller_item_count || 0} seller-routed
            item(s) and {typedOrder.store_item_count || 0} store-owned item(s).
            Keep payout and shipping evidence aligned before release.
          </p>
        </section>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <AdminSection
          eyebrow="Seller money"
          title="Seller Payout Ledger"
          detail="Seller-payable amounts, platform rake, and payout state for every seller-owned row in this order."
        >
          {payoutLedgerUnavailable ? (
            <UnavailableNotice
              title="Seller payout ledger unavailable."
              detail="Seller payout ledger storage did not load for this order, so do not release funds or treat this seller queue as clear until the ledger source is repaired."
              error={payoutLedgerError}
              tone="red"
            />
          ) : sellerPayoutLedger.length === 0 ? (
            <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-600">
              No seller payout ledger entries have been created for this order yet.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Dag Danky Holdings LLC Fee Total
                  </p>
                  <p className="mt-2 text-2xl font-black">
                    {money(platformFeeTotal)}
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
                    Seller Payable Total
                  </p>
                  <p className="mt-2 text-2xl font-black">
                    {money(sellerPayoutTotal)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {sellerPayoutLedger.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-bold">
                          Seller {entry.seller_account_id}
                        </p>
                        <p className="text-sm font-semibold text-neutral-600">
                          Order Item #{entry.order_item_id} -{" "}
                          {label(entry.payout_status)}
                        </p>
                      </div>

                      <p className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-black">
                        Rate{" "}
                        {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}
                        %
                      </p>
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                      <InfoTile label="Gross" value={money(Number(entry.gross_item_amount || 0))} />
                      <InfoTile label="Shipping Basis" value={money(Number(entry.shipping_allocated_amount || 0))} />
                      <InfoTile label="Dag Danky Holdings LLC Fee" value={money(Number(entry.platform_fee_amount || 0))} />
                      <InfoTile label="Seller Payable" value={money(Number(entry.seller_payable_amount || 0))} />
                    </dl>
                    <div className="mt-4 max-w-sm rounded-2xl border border-neutral-200 bg-white p-3">
                      <PayoutLedgerActions
                        ledgerEntryId={entry.id}
                        status={entry.payout_status}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </AdminSection>
      ) : null}

      <OrderReviewCasesPanel
        orderId={typedOrder.id}
        cases={orderReviewCases}
        sellerOptions={sellerOptions}
        payoutRows={sellerPayoutLedger}
        tableError={
          orderReviewCasesError ? safeErrorMessage(orderReviewCasesError) : null
        }
        caseEvents={orderReviewCaseEvents}
        eventsError={
          orderReviewCaseEventsError
            ? safeErrorMessage(orderReviewCaseEventsError)
            : null
        }
      />

      <AdminSection
        eyebrow="Buyer profile"
        title="Customer"
        detail="Buyer identity, linked TCOS account, and customer notes saved with this checkout."
      >
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InfoTile label="Name" value={typedOrder.customer_name || "Not saved"} />
          <InfoTile label="Email" value={typedOrder.customer_email || "No email"} />
        </dl>

        <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
            Linked TCOS Account
          </h3>
          {accountProfile ? (
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <InfoTile label="Account Email" value={accountProfile.email || "Not saved"} />
              <InfoTile label="Display Name" value={accountProfile.display_name || "Not saved"} />
              <InfoTile label="Status" value={label(accountProfile.account_status)} />
              <InfoTile label="Account Type" value={label(accountProfile.default_account_type)} />
              <InfoTile label="Account ID" value={accountProfile.id} wide />
            </dl>
          ) : (
            <p className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm font-semibold text-neutral-600">
              {typedOrder.account_id
                ? "This order has an account ID, but the account profile could not be loaded."
                : "Guest checkout. No TCOS account was linked to this order."}
            </p>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
            Customer Notes
          </h3>
          <p className="mt-2 whitespace-pre-wrap rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold leading-6">
            {typedOrder.customer_notes?.trim() || "No customer notes."}
          </p>
        </div>
      </AdminSection>

      <AdminSection
        eyebrow="Fulfillment address"
        title="Ship To"
        detail="Destination currently saved for label purchase, packing slip, and evidence packets."
      >
        {typedOrder.shipping_address_line1 ? (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-bold leading-7">
            <p>{typedOrder.customer_name || typedOrder.customer_email || "Recipient not saved"}</p>
            <p>{typedOrder.shipping_address_line1}</p>
            {typedOrder.shipping_address_line2 && (
              <p>{typedOrder.shipping_address_line2}</p>
            )}
            <p>
              {typedOrder.shipping_city}
              {typedOrder.shipping_city && typedOrder.shipping_state ? ", " : ""}
              {typedOrder.shipping_state} {typedOrder.shipping_postal_code}
            </p>
            <p>{typedOrder.shipping_country}</p>
          </div>
        ) : (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-950">
            Shipping address not saved. Do not purchase postage until the destination is verified.
          </p>
        )}
      </AdminSection>

      <AdminSection
        eyebrow="Order contents"
        title="Items"
        detail="Every purchased row with owner, quantity, unit price, and extended total."
      >
        {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
          <p className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-600">
            No order items found.
          </p>
        ) : (
          <div className="space-y-3">
            {typedOrder.order_items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 md:flex-row md:items-start md:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-bold">{item.title}</p>
                  <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-neutral-500">
                    Owner: {item.seller_account_id || "Store inventory"}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-neutral-600">
                    Quantity: {item.quantity} × {money(item.price)}
                  </p>
                </div>

                <p className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm font-black">
                  {money(Number(item.price) * Number(item.quantity))}
                </p>
              </div>
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection
        eyebrow="Checkout math"
        title="Order Totals"
        detail="Customer-paid subtotal, discount, shipping, and final total."
      >
        <div className="max-w-xl space-y-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex justify-between gap-4">
            <span>Items Total</span>
            <strong>{money(itemsTotal)}</strong>
          </div>

          <div className="flex justify-between gap-4">
            <span>
              Discount
              {typedOrder.discount_code ? ` (${typedOrder.discount_code})` : ""}
            </span>
            <strong>-{money(discountAmount)}</strong>
          </div>

          <div className="flex justify-between gap-4">
            <span>Shipping Paid</span>
            <strong>{money(shippingPaid)}</strong>
          </div>

          <div className="flex justify-between gap-4 border-t border-neutral-200 pt-3 text-xl">
            <span>Total Paid</span>
            <strong>{money(totalPaid)}</strong>
          </div>
        </div>
      </AdminSection>

      <AdminSection
        eyebrow="Shipment summary"
        title="Shipping"
        detail="Current fulfillment fields on the order record before label-specific audit details below."
      >
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <InfoTile label="Method" value={typedOrder.shipping_name || typedOrder.shipping_method || "Not selected"} />
          <InfoTile label="Shipping Paid" value={money(typedOrder.shipping_amount)} />
          <InfoTile label="Items" value={typedOrder.item_count || 0} />
          <InfoTile label="Carrier" value={typedOrder.carrier || "Not added"} />
          <InfoTile label="Tracking" value={typedOrder.tracking_number || "Not added"} />
          <InfoTile
            label="Shipped At"
            value={
              typedOrder.shipped_at
                ? new Date(typedOrder.shipped_at).toLocaleString()
                : "Not shipped"
            }
          />
        </dl>
      </AdminSection>

      <AdminSection
        eyebrow="Label audit"
        title="Shipping Label + Coverage"
        detail="Provider-ready records for label purchase, shipment tracking, and seller protection coverage."
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <ShippingLabelActions
            orderId={typedOrder.id}
            activeDryRunLabel={activeDryRunShippingLabel}
            initialAction={shippingAction}
          />
        </div>

        {shippingAction === "manualPurchase" ? (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-black text-blue-950">
            Dry-run cleanup sent you here. Save real external label details,
            tracking or IMb, postage, and Coverage policy proof before marking
            this order shipped or releasing seller funds.
          </div>
        ) : null}

        {shippingLabelsUnavailable ? (
          <div className="mt-4">
            <UnavailableNotice
              title="Shipping label records unavailable."
              detail="Shipping label storage did not load for this order, so this cockpit cannot prove whether a label record, provider purchase, tracking number, or coverage policy exists."
              error={shippingLabelsError}
            />
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {shippingProviderReadiness.map((item) => (
            <div
              key={item.key}
              className={`rounded-2xl border p-4 shadow-sm ${
                item.status === "ready"
                  ? "border-green-200 bg-green-50 text-green-950"
                  : item.status === "blocked"
                    ? "border-red-200 bg-red-50 text-red-950"
                    : "border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-black">{item.label}</h3>
                <span className="rounded-full border border-current px-3 py-1 text-xs font-black uppercase">
                  {label(item.status)}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold">{item.detail}</p>
              <p className="mt-2 text-xs font-bold">{item.action}</p>
            </div>
          ))}
        </div>

        {!shippingLabelsUnavailable && shippingLabels.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-700">
            No label record has been prepared yet. Preparing one does not buy a
            live label; it creates the TCOS audit record that the provider
            adapter will later purchase against.
          </div>
        ) : !shippingLabelsUnavailable ? (
          <div className="mt-4 space-y-4">
            {shippingLabels.map((shippingLabel) => {
              const policyNote = standardEnvelopePolicyNote(shippingLabel);
              const dryRun = isDryRunShippingLabel(
                shippingLabel,
                shippingTrackingEvents,
              );
              const adapterProfile =
                shippingAdapterProfileDetails(shippingLabel.metadata);
              const purchaseAttemptAudit = buildShippingPurchaseAttemptAudit(
                shippingLabel.metadata?.latest_purchase_attempt,
              );

              return (
              <div key={shippingLabel.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black">
                        {shippingLabel.provider_service ||
                          typedOrder.shipping_name ||
                          "Shipping Label"}
                      </p>
                      {dryRun ? (
                        <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-black text-red-900">
                          DRY-RUN / DO NOT MAIL
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-neutral-600">
                      Status: {label(shippingLabel.label_status)} / Coverage:{" "}
                      {label(shippingLabel.coverage_status)}
                    </p>
                    {dryRun ? (
                      <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-950">
                        Simulated shipping record only. No real postage, USPS
                        label, or external Coverage policy was purchased.
                      </p>
                    ) : null}
                    {policyNote ? (
                      <p className="mt-2 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-950">
                        {policyNote}
                      </p>
                    ) : null}
                    {adapterProfile ? (
                      <div className="mt-2 rounded-2xl border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950">
                        <p className="font-black">
                          Adapter: {label(adapterProfile.adapter)} /{" "}
                          {label(adapterProfile.status)}
                        </p>
                        <p className="mt-1 font-semibold">
                          {adapterProfile.provider} - {adapterProfile.service} -{" "}
                          {adapterProfile.carrier}
                        </p>
                        <p className="mt-1 text-xs font-bold">
                          Purchase mode: {label(adapterProfile.purchaseMode)}
                          {adapterProfile.missingCredentials.length > 0
                            ? ` / Missing: ${adapterProfile.missingCredentials.join(
                                ", ",
                              )}`
                            : " / Provider credentials staged"}
                        </p>
                        {adapterProfile.liveBlockReason ? (
                          <p className="mt-1 text-xs font-bold">
                            {adapterProfile.liveBlockReason}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {purchaseAttemptAudit.present ? (
                      <div
                        className={`mt-2 rounded-2xl border p-3 text-sm ${
                          purchaseAttemptAudit.standardEnvelopeEvidenceContractReady
                            ? "border-green-200 bg-green-50 text-green-950"
                            : "border-amber-200 bg-amber-50 text-amber-950"
                        }`}
                      >
                        <p className="font-black">
                          Latest provider purchase attempt
                        </p>
                        <p className="mt-1 font-semibold">
                          {purchaseAttemptAudit.evidenceSummary ||
                            "Standard Envelope evidence validator: Not saved."}
                        </p>
                        {purchaseAttemptAudit.details.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs font-bold">
                            {purchaseAttemptAudit.details
                              .slice(0, 4)
                              .map((detail) => (
                                <li key={detail}>{detail}</li>
                              ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <p className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-black">
                    {shippingLabel.provider || "Provider pending"}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <InfoTile label="Service" value={label(shippingLabel.resolved_shipping_method)} />
                  <InfoTile label="Requested" value={label(shippingLabel.requested_shipping_method)} />
                  <InfoTile label="Resolved" value={label(shippingLabel.resolved_shipping_method)} />
                  <InfoTile label="Carrier" value={shippingLabel.carrier || "Pending"} />
                  <InfoTile label="Tracking" value={shippingLabel.tracking_number || "Pending"} />
                  <InfoTile label="Postage" value={money(Number(shippingLabel.postage_amount || 0))} />
                  <InfoTile label="Coverage Provider" value={shippingLabel.coverage_provider || "Coverage"} />
                  <InfoTile label="Coverage Amount" value={money(Number(shippingLabel.coverage_amount || 0))} />
                  <InfoTile label="Policy ID" value={shippingLabel.coverage_policy_id || "Pending purchase"} />
                  <InfoTile label="Created" value={dateLabel(shippingLabel.created_at)} />
                </dl>

                {shippingLabel.label_url || shippingLabel.label_pdf_url ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href={`/api/admin/shipping-labels/${shippingLabel.id}/packet`}
                      className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
                    >
                      Download Label Packet
                    </a>
                    {shippingLabel.label_pdf_url ? (
                      <a
                        href={shippingLabel.label_pdf_url}
                        className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
                      >
                        Open Label PDF
                      </a>
                    ) : null}
                    {shippingLabel.label_url ? (
                      <a
                        href={shippingLabel.label_url}
                        className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
                      >
                        Open Label
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <a
                      href={`/api/admin/shipping-labels/${shippingLabel.id}/packet`}
                      className="inline-flex rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
                    >
                      Download Label Packet
                    </a>
                    <p className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-950">
                      No printable label URL is stored yet. Use the label packet
                      for the current audit trail, tracking, provider IDs, and
                      Coverage details.
                    </p>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="font-black">Tracking Events</h3>
            {shippingTrackingEventsUnavailable ? (
              <div className="mt-3">
                <UnavailableNotice
                  title="Tracking event history unavailable."
                  detail="Tracking event storage did not load for this order, so delivery scans, provider events, and LetterTrack evidence cannot be trusted yet."
                  error={shippingTrackingEventsError}
                />
              </div>
            ) : shippingTrackingEvents.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">
                No tracking events have been recorded yet.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {shippingTrackingEvents.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-neutral-200 bg-white p-3">
                    <p className="font-bold">
                      {label(event.event_type)} / {label(event.event_status)}
                    </p>
                    <p className="text-sm font-semibold text-neutral-600">
                      {event.message || event.event_code || "Tracking update"}
                    </p>
                    <p className="text-xs font-semibold text-neutral-500">
                      {dateLabel(event.occurred_at)}
                      {event.location ? ` / ${event.location}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="font-black">Coverage Claims</h3>
            {shippingCoverageClaimsUnavailable ? (
              <div className="mt-3">
                <UnavailableNotice
                  title="Coverage claim history unavailable."
                  detail="Coverage claim storage did not load for this order, so loss, damage, or seller-protection claim status cannot be trusted yet."
                  error={shippingCoverageClaimsError}
                />
              </div>
            ) : shippingCoverageClaims.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">
                No loss/damage coverage claims have been opened.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {shippingCoverageClaims.map((claim) => {
                  const currentEvidence =
                    buildLetterTrackDeliveryEvidenceSummary(
                      claim.shipping_label_id
                        ? shippingTrackingEventsByLabelId.get(
                            claim.shipping_label_id,
                          ) || []
                        : [],
                    );
                  const under20Claim = metadataRecord(
                    claim.metadata,
                    "under_20_seller_protection_claim",
                  );
                  const currentGate =
                    under20Claim?.eligible === true
                      ? evaluateLetterTrackSellerProtectionPaymentMetadataGate({
                          evidence: currentEvidence,
                          metadata: claim.metadata,
                        })
                      : null;

                  return (
                    <div key={claim.id} className="rounded-2xl border border-neutral-200 bg-white p-3">
                      <p className="font-bold">
                        {claim.provider || "Coverage"} /{" "}
                        {label(claim.claim_status)}
                      </p>
                      <p className="text-sm font-semibold text-neutral-600">
                        {label(claim.claim_type)} for{" "}
                        {money(Number(claim.claim_amount || 0))}
                      </p>
                      <p className="text-xs font-semibold text-neutral-500">
                        {claim.provider_claim_id || "Provider claim pending"} /{" "}
                        {dateLabel(claim.created_at)}
                      </p>
                      {claim.reason ? (
                        <p className="mt-1 text-sm">{claim.reason}</p>
                      ) : null}
                      <ShippingClaimActions
                        claimId={claim.id}
                        claimStatus={claim.claim_status}
                        providerClaimId={claim.provider_claim_id}
                        claimMetadata={claim.metadata}
                        currentLetterTrackEvidence={currentEvidence}
                        currentLetterTrackPaymentGate={currentGate}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs font-semibold text-neutral-500">
          Active label records for this order: {shippingLabelIds.length}. This
          cockpit is the source of truth for future provider adapters.
        </p>
      </AdminSection>

      <AdminSection
        eyebrow="Dispute defense"
        title="Chargeback Evidence"
        detail="Terms acceptance, identity/risk trail, and the latest downloadable evidence packet for this order."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
              Terms And Identity
            </h3>
            <dl className="mt-3 grid gap-3">
              <InfoTile label="TOS Accepted" value={typedOrder.tos_accepted ? "Yes" : "No"} />
              <InfoTile label="Version" value={typedOrder.tos_version || "Not saved"} />
              <InfoTile
                label="Accepted At"
                value={
                  typedOrder.tos_accepted_at
                    ? new Date(typedOrder.tos_accepted_at).toLocaleString()
                    : "Not saved"
                }
              />
              <InfoTile label="IP Address" value={typedOrder.tos_ip_address || "Not saved"} />
              <InfoTile label="IP Risk" value={typedOrder.tos_ip_risk || "Not saved"} />
              <InfoTile label="Block Reason" value={typedOrder.tos_ip_block_reason || "None saved"} />
              <InfoTile label="Acceptance Event" value={typedOrder.tos_acceptance_event_id || "Not saved"} />
            </dl>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
              Evidence Packet
            </h3>

            {evidenceUnavailable ? (
              <div className="mt-3">
                <UnavailableNotice
                  title="Evidence packet history unavailable."
                  detail="Evidence storage did not load for this order, so chargeback packets and delivery proof cannot be treated as missing or complete yet."
                  error={evidenceError}
                  tone="red"
                />
              </div>
            ) : latestEvidence ? (
              <div className="mt-3">
                <dl className="grid gap-3">
                  <InfoTile label="Status" value={latestEvidence.status || "ready"} />
                  <InfoTile
                    label="Created"
                    value={new Date(latestEvidence.created_at).toLocaleString()}
                  />
                  <InfoTile
                    label="Last Updated"
                    value={
                      latestEvidence.updated_at
                        ? new Date(latestEvidence.updated_at).toLocaleString()
                        : "Not saved"
                    }
                  />
                  <InfoTile
                    label="Email"
                    value={
                      latestEvidence.email_sent_at
                        ? `Sent to ${latestEvidence.emailed_to}`
                        : latestEvidence.email_error || "Not sent"
                    }
                  />
                </dl>

                <a
                  href={`/api/admin/files/${latestEvidence.id}/download`}
                  className="mt-4 inline-flex rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-black text-white"
                >
                  Download Evidence PDF
                </a>
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4 text-sm font-semibold text-neutral-600">
                No evidence packet has been created for this order yet.
              </p>
            )}
          </div>
        </div>
      </AdminSection>

      <AdminSection
        eyebrow="Fulfillment action"
        title="Add Tracking"
        detail="Save tracking and mark shipped only after review holds and dry-run label blockers are cleared."
      >
        <TrackingForm
          orderId={typedOrder.id}
          currentCarrier={typedOrder.carrier || ""}
          currentTrackingNumber={typedOrder.tracking_number || ""}
          canMarkShipped={!needsReview}
          reviewMessage={needsReview ? reviewMessage : undefined}
          dryRunShippingBlocked={activeDryRunShippingLabel}
        />
      </AdminSection>

      <AdminSection
        eyebrow="Operator shortcuts"
        title="Actions"
        detail="Final order utilities for evidence review and fulfillment paperwork."
      >
        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/files"
            className="rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm font-black"
          >
            Evidence Files
          </Link>

          <Link
            href={`/admin/orders/${typedOrder.id}/packing-slip`}
            className="rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-black text-white"
          >
            Print Packing Slip
          </Link>
        </div>
      </AdminSection>
      </div>
    </main>
  );
}
