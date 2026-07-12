import Link from "next/link";
import type { ReactNode } from "react";
import {
  getShippingProviderAdapterProfile,
  type ShippingProviderAdapterProfile,
} from "../../../lib/shipping-provider-adapter";
import {
  buildShippingProviderSetupPacket,
  type LiveShippingRequirement,
  type ProviderSetupDecision,
} from "../../../lib/shipping-provider-setup";
import { isDryRunShippingLabel as isDryRunShippingLabelRecord } from "../../../lib/shipping-dry-run";
import { getDryRunShippingProofByOrder } from "../../../lib/shipping-dry-run-cleanup";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import DryRunCleanupActions from "./DryRunCleanupActions";
import ShippingClaimActions from "./ShippingClaimActions";
import {
  MarkOrderShippedButton,
  SaveCoveragePolicyForm,
  SaveTrackingForm,
} from "./ShippingQueueActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  provider_service: string | null;
  service_level: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_status: string | null;
  requested_shipping_method: string | null;
  resolved_shipping_method: string | null;
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
  shipping_method: string | null;
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
  event_code: string | null;
  event_status: string | null;
  message: string | null;
  location: string | null;
  occurred_at: string;
  raw_payload?: Record<string, unknown> | null;
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
  created_at: string;
};

type PrioritySeverity = "critical" | "warning" | "watch";

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function oldestDate(values: Array<string | null | undefined>) {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return sorted[0] || null;
}

function statusTone(status: string | null | undefined) {
  if (
    status === "ready" ||
    status === "covered" ||
    status === "purchased" ||
    status === "printed" ||
    status === "shipped" ||
    status === "delivered"
  ) {
    return "border-green-200 bg-green-50 text-green-900";
  }

  if (
    status === "planned" ||
    status === "purchase_pending" ||
    status === "required_at_label_purchase" ||
    status === "rate_selected" ||
    status === "submitted" ||
    status === "under_review"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (
    status === "blocked" ||
    status === "failed" ||
    status === "claim_denied" ||
    status === "denied" ||
    status === "voided"
  ) {
    return "border-red-200 bg-red-50 text-red-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-800";
}

function priorityTone(severity: PrioritySeverity) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-blue-200 bg-blue-50 text-blue-950";
}

function orderFor(
  ordersById: Map<number, OrderRow>,
  labelRow: Pick<ShippingLabelRow, "order_id">,
) {
  return ordersById.get(labelRow.order_id) || null;
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

function isDryRunLabel(row: ShippingLabelRow) {
  return isDryRunShippingLabelRecord(row);
}

function standardEnvelopePolicyNote(row: ShippingLabelRow) {
  const reason =
    metadataText(row.metadata, "shipping_policy_reason") ||
    metadataText(row.metadata, "standard_envelope_reason");
  const estimatedOz = metadataNumber(row.metadata, "standard_envelope_estimated_oz");

  if (!reason && row.requested_shipping_method === row.resolved_shipping_method) {
    return null;
  }

  const transition =
    row.requested_shipping_method && row.resolved_shipping_method
      ? `${label(row.requested_shipping_method)} -> ${label(row.resolved_shipping_method)}`
      : null;

  return [transition, estimatedOz ? `${estimatedOz} estimated oz` : null, reason]
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

function credentialSummary(missing: string[]) {
  return missing.length > 0
    ? `Missing: ${missing.join(", ")}`
    : "Credential groups staged";
}

function setupDecisionTone(status: ProviderSetupDecision["status"]) {
  if (status === "live_blocked") {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (status === "needs_provider_setup") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (status === "ready_for_live_adapter_build") {
    return "border-blue-200 bg-blue-50 text-blue-950";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-950";
}

function ProviderSetupDecisionPanel({
  decision,
}: {
  decision: ProviderSetupDecision;
}) {
  return (
    <div className={`mt-4 rounded border p-4 ${setupDecisionTone(decision.status)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-75">
            Shipping setup verdict
          </p>
          <h4 className="mt-1 text-lg font-black">{label(decision.status)}</h4>
        </div>
        <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
          Go / no-go
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold">{decision.summary}</p>
      <p className="mt-2 text-xs font-bold">{decision.nextAction}</p>
      {decision.blockers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.blockers.map((blocker) => (
            <span
              key={blocker}
              className="rounded border border-current px-2 py-1 text-[11px] font-black"
            >
              {blocker}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderGoLiveRunway({
  decision,
  liveRequirements,
}: {
  decision: ProviderSetupDecision;
  liveRequirements: LiveShippingRequirement[];
}) {
  const credentialsReady =
    decision.status === "dry_run_only" ||
    decision.status === "ready_for_live_adapter_build";
  const liveModeBlocked = decision.status === "live_blocked";

  const runway = [
    {
      title: "Operate safely today",
      status: "Allowed now",
      detail:
        "Use dry-run plans, export provider packets, buy labels externally, and record real tracking/Coverage references manually.",
      tone: "border-green-200 bg-green-50 text-green-950",
    },
    {
      title: "Finish provider credentials",
      status: credentialsReady ? "Staged" : "Needs setup",
      detail: credentialsReady
        ? "Required secret groups appear staged; keep values out of exports and logs."
        : "Add the missing Standard Envelope, parcel-label, and Coverage provider secret groups before live adapter work.",
      tone: credentialsReady
        ? "border-green-200 bg-green-50 text-green-950"
        : "border-amber-200 bg-amber-50 text-amber-950",
    },
    {
      title: "Build the live adapter",
      status:
        decision.status === "ready_for_live_adapter_build"
          ? "Ready to build"
          : "Not approved",
      detail:
        "Live code must quote, buy, void, purchase Coverage, reconcile webhooks, and produce audit packets before money-moving use.",
      tone:
        decision.status === "ready_for_live_adapter_build"
          ? "border-blue-200 bg-blue-50 text-blue-950"
          : "border-neutral-200 bg-neutral-50 text-neutral-950",
    },
    {
      title: "Do not cross this line",
      status: liveModeBlocked ? "Blocked now" : "Guardrail",
      detail:
        "Do not mail dry-run labels, mark dry-run tracking as shipped, or switch live mode on until launch-readiness and simulations are clean.",
      tone: liveModeBlocked
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-red-100 bg-red-50 text-red-950",
    },
  ];

  return (
    <div className="mt-4 rounded border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-black">Live Shipping Runway</h4>
          <p className="mt-1 max-w-3xl text-sm text-neutral-600">
            This is the operator handoff between planning labels and actually
            buying postage or seller Coverage.
          </p>
        </div>
        <span className="rounded border border-neutral-300 px-2 py-1 text-xs font-black uppercase text-neutral-700">
          Manual approval required
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
        {runway.map((item) => (
          <article key={item.title} className={`rounded border p-3 ${item.tone}`}>
            <div className="flex items-start justify-between gap-2">
              <h5 className="font-black">{item.title}</h5>
              <span className="rounded border border-current px-2 py-1 text-[10px] font-black uppercase">
                {item.status}
              </span>
            </div>
            <p className="mt-2 text-xs font-bold">{item.detail}</p>
          </article>
        ))}
      </div>

        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 className="font-black">Live Adapter Approval Checklist</h5>
            <p className="mt-1 max-w-3xl text-xs font-semibold text-neutral-600">
              Secrets are not enough. These gates must all be ready before TCOS
              treats live postage, Coverage purchase, voiding, webhooks, or
              reconciliation as approved.
            </p>
          </div>
          <span
            className={`rounded border px-2 py-1 text-xs font-black uppercase ${
              liveRequirements.every((requirement) => requirement.status === "ready")
                ? "border-green-300 bg-green-50 text-green-950"
                : "border-red-300 bg-red-50 text-red-950"
            }`}
          >
            {liveRequirements.filter((requirement) => requirement.status === "ready").length}
            /{liveRequirements.length} ready
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {liveRequirements.map((requirement) => (
            <article
              key={requirement.key}
              className={`rounded border p-3 ${
                requirement.status === "ready"
                  ? "border-green-200 bg-green-50 text-green-950"
                  : "border-red-200 bg-white text-red-950"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h6 className="font-black">{requirement.label}</h6>
                <span className="rounded border border-current px-2 py-1 text-[10px] font-black uppercase">
                  {requirement.status}
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold">{requirement.detail}</p>
              <p className="mt-2 text-xs font-black">{requirement.action}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] font-bold opacity-80">
                {requirement.evidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/shipping/simulations"
            className="rounded bg-neutral-950 px-3 py-2 text-xs font-black text-white"
          >
            Run Live Approval Simulation
          </Link>
          <a
            href="/api/admin/shipping/provider-setup"
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950"
          >
            Provider Setup JSON
          </a>
        </div>
      </div>
    </div>
  );
}

function ProviderSetupCard({
  title,
  profile,
  mode = "method",
}: {
  title: string;
  profile: ShippingProviderAdapterProfile;
  mode?: "method" | "coverage";
}) {
  const missing =
    mode === "coverage"
      ? profile.missingCoverageCredentialKeys
      : profile.missingCredentialKeys;
  const configured =
    mode === "coverage"
      ? profile.configuredCoverageCredentialKeys
      : profile.configuredCredentialKeys;
  const allKeys =
    mode === "coverage" ? profile.coverageCredentialKeys : profile.credentialKeys;

  return (
    <article
      className={`rounded border p-4 ${
        missing.length === 0
          ? "border-green-200 bg-green-50 text-green-950"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{title}</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest opacity-75">
            {mode === "coverage" ? "Coverage adapter" : label(profile.adapterKey)}
          </p>
        </div>
        <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
          {missing.length === 0 ? "Ready keys" : "Needs keys"}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
        <Info
          label="Provider"
          value={mode === "coverage" ? profile.coverageProvider : profile.provider}
        />
        {mode === "method" ? (
          <>
            <Info label="Service" value={profile.providerService} />
            <Info label="Carrier" value={profile.carrier} />
          </>
        ) : null}
        <Info label="Purchase mode" value={label(profile.purchaseMode)} />
        <Info
          label="Live purchase"
          value={
            profile.livePurchaseSupported
              ? "Supported"
              : "Blocked until adapter approval"
          }
        />
      </dl>

      <div className="mt-3 rounded border border-current/20 bg-white/60 p-3">
        <p className="text-xs font-black uppercase tracking-widest">
          Required secret groups
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs font-bold">
          {allKeys.map((key) => (
            <li key={`${title}-${key}`}>
              {key}
              {configured.includes(key) ? " configured" : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs font-black">{credentialSummary(missing)}</p>
      </div>
    </article>
  );
}

export default async function AdminShippingPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const providerSetupPacket = buildShippingProviderSetupPacket();
  const providerReadiness = providerSetupPacket.readiness;
  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const groundAdvantageProfile =
    getShippingProviderAdapterProfile("GROUND_ADVANTAGE");

  const [labelsResult, eventsResult, claimsResult, dryRunOrderCandidatesResult] =
    await Promise.all([
    supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,provider,provider_label_id,provider_shipment_id,provider_service,service_level,carrier,tracking_number,label_status,requested_shipping_method,resolved_shipping_method,coverage_provider,coverage_status,coverage_amount,coverage_policy_id,postage_amount,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("order_shipping_tracking_events")
      .select(
        "id,order_id,shipping_label_id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
      )
      .eq("store_id", storeId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("order_shipping_coverage_claims")
      .select(
        "id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_type,claim_amount,reason,created_at",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("orders")
      .select(
        "id,customer_email,total,status,fulfillment_status,shipping_name,shipping_method,tracking_number,carrier,created_at",
      )
      .eq("store_id", storeId)
      .not("tracking_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const labels = labelsResult.error
    ? []
    : ((labelsResult.data || []) as ShippingLabelRow[]);
  const events = eventsResult.error
    ? []
    : ((eventsResult.data || []) as TrackingEventRow[]);
  const claims = claimsResult.error
    ? []
    : ((claimsResult.data || []) as CoverageClaimRow[]);
  const dryRunOrderCandidates = dryRunOrderCandidatesResult.error
    ? []
    : ((dryRunOrderCandidatesResult.data || []) as OrderRow[]);
  const orderIds = Array.from(
    new Set([
      ...labels.map((row) => row.order_id),
      ...events.map((row) => row.order_id),
      ...claims.map((row) => row.order_id),
      ...dryRunOrderCandidates.map((row) => row.id),
    ]),
  );
  const ordersResult =
    orderIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("orders")
          .select(
            "id,customer_email,total,status,fulfillment_status,shipping_name,shipping_method,tracking_number,carrier,created_at",
          )
          .eq("store_id", storeId)
          .in("id", orderIds);
  const ordersById = new Map(
    [
      ...dryRunOrderCandidates,
      ...((ordersResult.data || []) as OrderRow[]),
    ].map((order) => [order.id, order]),
  );
  const dryRunProofByOrder = await getDryRunShippingProofByOrder({
    supabase,
    storeId,
    orderIds,
  });
  const dryRunCleanupRows = Array.from(dryRunProofByOrder.values())
    .filter((proof) => proof.hasDryRun)
    .sort((a, b) => b.total - a.total || a.orderId - b.orderId);

  const plannedLabels = labels.filter((row) => row.label_status === "planned");
  const pendingPurchases = labels.filter((row) =>
    ["purchase_pending", "rate_selected"].includes(row.label_status || ""),
  );
  const purchasedLabels = labels.filter((row) =>
    ["purchased", "printed"].includes(row.label_status || ""),
  );
  const dryRunPurchasedLabels = purchasedLabels.filter(isDryRunLabel);
  const realPurchasedLabels = purchasedLabels.filter((row) => !isDryRunLabel(row));
  const voidedLabels = labels.filter((row) => row.label_status === "voided");
  const coveragePending = labels.filter((row) =>
    ["required_at_label_purchase", "purchase_pending"].includes(
      row.coverage_status || "",
    ),
  );
  const blockedEvents = events.filter(
    (event) => event.event_type === "provider_purchase_blocked",
  );
  const manualRecordEvents = events.filter((event) =>
    ["manual_label_purchase_recorded", "manual_label_void_recorded"].includes(
      event.event_type || "",
    ),
  );
  const fulfilledStatuses = new Set([
    "shipped",
    "delivered",
    "fulfilled",
    "complete",
    "completed",
  ]);
  const readyToMarkShippedLabels = realPurchasedLabels.filter((row) => {
    const order = orderFor(ordersById, row);
    const hasTracking = Boolean(row.tracking_number || order?.tracking_number);
    const isAlreadyFulfilled = fulfilledStatuses.has(
      (order?.fulfillment_status || "").toLowerCase(),
    );

    return hasTracking && !isAlreadyFulfilled;
  });
  const trackingMissingLabels = realPurchasedLabels.filter((row) => {
    const order = orderFor(ordersById, row);

    return !row.tracking_number && !order?.tracking_number;
  });
  const coveragePolicyMissingLabels = realPurchasedLabels.filter(
    (row) => row.coverage_status !== "covered" || !row.coverage_policy_id,
  );
  const replacementNeededLabels = voidedLabels.filter((row) => {
    const hasNewerActiveLabel = labels.some(
      (candidate) =>
        candidate.order_id === row.order_id &&
        candidate.id !== row.id &&
        candidate.created_at > row.created_at &&
        !["voided", "failed"].includes(candidate.label_status || ""),
    );

    return !hasNewerActiveLabel;
  });
  const openClaims = claims.filter(
    (claim) =>
      !["paid", "denied", "cancelled"].includes(claim.claim_status || "draft"),
  );
  const priorityIssues = [
    {
      key: "blocked_purchase",
      title: "Blocked Purchase Attempts",
      count: blockedEvents.length,
      severity: "critical" as PrioritySeverity,
      detail: "Provider purchase was blocked. Fix the provider setup or record the external label.",
      href: blockedEvents[0]?.order_id
        ? `/admin/orders/${blockedEvents[0].order_id}`
        : "/admin/shipping",
      cta: "Open first blocked order",
      oldestAt: oldestDate(blockedEvents.map((event) => event.occurred_at)),
    },
    {
      key: "dry_run_labels",
      title: "Dry-Run Labels Are Not Shippable",
      count: dryRunPurchasedLabels.length,
      severity: "critical" as PrioritySeverity,
      detail:
        "Simulated labels have no real postage or external Coverage policy. Buy or record a real label before mailing.",
      href: dryRunPurchasedLabels[0]?.order_id
        ? `/admin/orders/${dryRunPurchasedLabels[0].order_id}`
        : "/admin/shipping",
      cta: "Open dry-run order",
      oldestAt: oldestDate(
        dryRunPurchasedLabels.map((row) => row.updated_at || row.created_at),
      ),
    },
    {
      key: "tracking_missing",
      title: "Tracking Missing",
      count: trackingMissingLabels.length,
      severity: "critical" as PrioritySeverity,
      detail: "Purchased labels need tracking or IMb saved before shipment can be trusted.",
      href: trackingMissingLabels[0]?.order_id
        ? `/admin/orders/${trackingMissingLabels[0].order_id}`
        : "/admin/shipping",
      cta: "Save tracking",
      oldestAt: oldestDate(
        trackingMissingLabels.map((row) => row.updated_at || row.created_at),
      ),
    },
    {
      key: "replacement_needed",
      title: "Replacement Needed",
      count: replacementNeededLabels.length,
      severity: "critical" as PrioritySeverity,
      detail: "Voided labels need a newer active replacement before the order can ship cleanly.",
      href: replacementNeededLabels[0]?.order_id
        ? `/admin/orders/${replacementNeededLabels[0].order_id}`
        : "/admin/shipping",
      cta: "Create replacement",
      oldestAt: oldestDate(
        replacementNeededLabels.map((row) => row.updated_at || row.created_at),
      ),
    },
    {
      key: "policy_missing",
      title: "Coverage Policy Missing",
      count: coveragePolicyMissingLabels.length,
      severity: "warning" as PrioritySeverity,
      detail: "Coverage was expected, but policy details are incomplete.",
      href: coveragePolicyMissingLabels[0]?.order_id
        ? `/admin/orders/${coveragePolicyMissingLabels[0].order_id}`
        : "/admin/shipping",
      cta: "Record policy",
      oldestAt: oldestDate(
        coveragePolicyMissingLabels.map((row) => row.updated_at || row.created_at),
      ),
    },
    {
      key: "ready_to_ship",
      title: "Ready To Mark Shipped",
      count: readyToMarkShippedLabels.length,
      severity: "warning" as PrioritySeverity,
      detail: "Tracking exists; finish the fulfillment state and customer notification.",
      href: readyToMarkShippedLabels[0]?.order_id
        ? `/admin/orders/${readyToMarkShippedLabels[0].order_id}`
        : "/admin/shipping",
      cta: "Mark shipped",
      oldestAt: oldestDate(
        readyToMarkShippedLabels.map((row) => row.updated_at || row.created_at),
      ),
    },
    {
      key: "open_claims",
      title: "Open Coverage Claims",
      count: openClaims.length,
      severity: "watch" as PrioritySeverity,
      detail: "Claims need evidence, status updates, payout tracking, or closure.",
      href: openClaims[0]?.order_id
        ? `/admin/orders/${openClaims[0].order_id}`
        : "/admin/shipping",
      cta: "Review claim",
      oldestAt: oldestDate(openClaims.map((claim) => claim.created_at)),
    },
  ].filter((issue) => issue.count > 0);

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              Shipping operations
            </p>
            <h1 className="mt-2 text-4xl font-black">
              Label + Coverage Control
            </h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              One queue for Standard Envelope, Ground Advantage, Priority labels,
              Coverage protection, tracking events, and shipping claims.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="max-w-xs">
              <a
                href="/api/admin/shipping/exceptions"
                className="inline-flex rounded bg-neutral-950 px-4 py-2 font-black text-white"
              >
                Export Exceptions CSV
              </a>
              <p className="mt-1 text-xs font-semibold text-neutral-500">
                Ordered by severity and age with stable exception keys for audit
                follow-up.
              </p>
            </div>
            <div className="max-w-xs">
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/admin/shipping/provider-setup"
                  className="inline-flex rounded border border-neutral-300 bg-white px-4 py-2 font-black text-neutral-950"
                >
                  Setup JSON
                </a>
                <a
                  href="/api/admin/shipping/provider-setup?format=csv"
                  className="inline-flex rounded border border-neutral-300 bg-white px-4 py-2 font-black text-neutral-950"
                >
                  Setup CSV
                </a>
              </div>
              <p className="mt-1 text-xs font-semibold text-neutral-500">
                No-secret provider checklist for Standard Envelope, parcels,
                and Coverage.
              </p>
            </div>
            <Link href="/admin" className="rounded border bg-white px-4 py-2">
              Command Center
            </Link>
            <Link href="/admin/orders" className="rounded border bg-white px-4 py-2">
              Fulfillment
            </Link>
            <Link
              href="/admin/shipping/simulations"
              className="rounded border bg-white px-4 py-2"
            >
              Simulations
            </Link>
            <Link
              href="/admin/launch-readiness"
              className="rounded border bg-white px-4 py-2"
            >
              Readiness
            </Link>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-11">
          <Metric label="Planned Labels" value={plannedLabels.length} />
          <Metric label="Purchase Pending" value={pendingPurchases.length} />
          <Metric label="Purchased / Printed" value={purchasedLabels.length} />
          <Metric label="Dry-Run Purchased" value={dryRunPurchasedLabels.length} />
          <Metric label="Dry-Run Cleanup" value={dryRunCleanupRows.length} />
          <Metric label="Ready To Ship" value={readyToMarkShippedLabels.length} />
          <Metric label="Tracking Missing" value={trackingMissingLabels.length} />
          <Metric label="Voided Labels" value={voidedLabels.length} />
          <Metric label="Coverage Pending" value={coveragePending.length} />
          <Metric label="Policy Missing" value={coveragePolicyMissingLabels.length} />
          <Metric label="Open Claims" value={openClaims.length} />
        </section>

        <section className="rounded border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Provider Readiness</h2>
              <p className="mt-1 text-sm text-neutral-600">
                These determine whether the order cockpit can move from audit
                record to real label/coverage purchase.
              </p>
            </div>
            <span
              className={`rounded border px-3 py-1 text-sm font-black ${
                providerReadiness.every((item) => item.status === "ready")
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {providerReadiness.filter((item) => item.status === "ready").length}
              /{providerReadiness.length} ready
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {providerReadiness.map((item) => (
              <article
                key={item.key}
                className={`rounded border p-4 ${statusTone(item.status)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-black">{item.label}</h3>
                  <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
                    {label(item.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold">{item.detail}</p>
                <p className="mt-2 text-xs font-bold">{item.action}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black">Provider Setup Checklist</h3>
                <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                  This names the exact provider lanes TCOS can plan today. It
                  shows secret names only, never secret values. Live purchase
                  stays blocked until a real provider adapter is approved.
                </p>
              </div>
              <span className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-black uppercase text-neutral-700">
                No live API calls
              </span>
            </div>

            <ProviderSetupDecisionPanel
              decision={providerSetupPacket.decision}
            />

            <ProviderGoLiveRunway
              decision={providerSetupPacket.decision}
              liveRequirements={providerSetupPacket.liveRequirements}
            />

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <ProviderSetupCard
                title="Standard Envelope / IMb"
                profile={standardEnvelopeProfile}
              />
              <ProviderSetupCard
                title="Ground Advantage / Priority"
                profile={groundAdvantageProfile}
              />
              <ProviderSetupCard
                title="Shipment Coverage"
                profile={standardEnvelopeProfile}
                mode="coverage"
              />
            </div>
          </div>
        </section>

        {(labelsResult.error ||
          eventsResult.error ||
          claimsResult.error ||
          dryRunOrderCandidatesResult.error) ? (
          <section className="rounded border border-red-200 bg-red-50 p-5 text-red-950">
            <h2 className="font-black">Shipping tables need attention</h2>
            <p className="mt-2 text-sm font-semibold">
              {labelsResult.error?.message ||
                eventsResult.error?.message ||
                claimsResult.error?.message ||
                dryRunOrderCandidatesResult.error?.message}
            </p>
          </section>
        ) : null}

        <section
          id="dry-run-cleanup"
          className={`rounded border p-6 ${
            dryRunCleanupRows.length > 0
              ? "border-red-200 bg-red-50"
              : "border-green-200 bg-green-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
                Launch blocker cleanup
              </p>
              <h2 className="mt-1 text-2xl font-black">
                Dry-Run Shipping Cleanup Center
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-700">
                This is the exact residue that blocks live payments and seller
                payout release: simulated labels, simulated tracking events, or
                TCOS dry-run tracking saved on the order row.
              </p>
            </div>
            <span
              className={`rounded border px-3 py-1 text-sm font-black ${
                dryRunCleanupRows.length > 0
                  ? "border-red-300 bg-white text-red-950"
                  : "border-green-300 bg-white text-green-950"
              }`}
            >
              {dryRunCleanupRows.length === 0
                ? "No dry-run blockers"
                : `${dryRunCleanupRows.length} order blocker${
                    dryRunCleanupRows.length === 1 ? "" : "s"
                  }`}
            </span>
          </div>

          {dryRunCleanupRows.length === 0 ? (
            <p className="mt-5 rounded border border-green-200 bg-white p-4 text-sm font-bold text-green-950">
              No active dry-run shipping proof was found in the sampled shipping
              records. Keep running simulations, but do not let simulated proof
              ride into live checkout or payout release. Tiny broom, big money
              safety.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {dryRunCleanupRows.map((proof) => {
                const order = ordersById.get(proof.orderId);

                return (
                  <article
                    key={proof.orderId}
                    className="rounded border border-red-200 bg-white p-4 text-red-950"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/admin/orders/${proof.orderId}`}
                          className="text-lg font-black underline"
                        >
                          Order #{proof.orderId}
                        </Link>
                        <p className="mt-1 text-sm font-semibold">
                          {order?.customer_email || "No customer email"} /{" "}
                          {money(order?.total)} /{" "}
                          {label(order?.fulfillment_status)}
                        </p>
                      </div>
                      <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black">
                        {proof.total} dry-run ref{proof.total === 1 ? "" : "s"}
                      </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <Info
                        label="Labels"
                        value={String(proof.dryRunLabelCount)}
                      />
                      <Info
                        label="Events"
                        value={String(proof.dryRunEventCount)}
                      />
                      <Info
                        label="Order Tracking"
                        value={proof.dryRunOrderTracking ? "Dry-run" : "Clean"}
                      />
                    </dl>

                    <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm font-bold">
                      {proof.detail}
                    </p>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                      <DryRunCleanupActions orderId={proof.orderId} />
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/admin/orders/${proof.orderId}?shippingAction=manualPurchase`}
                          className="rounded bg-neutral-950 px-3 py-2 text-center text-xs font-black text-white"
                        >
                          Record Real Label
                        </Link>
                        <a
                          href={`/api/admin/shipping/exceptions`}
                          className="rounded border border-neutral-300 bg-white px-3 py-2 text-center text-xs font-black text-neutral-950"
                        >
                          Export Exceptions
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Fulfillment Priority Stack</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Work this from top to bottom. Red items can block shipment trust;
                amber items finish the customer/admin audit trail.
              </p>
            </div>
            <span
              className={`rounded border px-3 py-1 text-sm font-black ${
                priorityIssues.length === 0
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              {priorityIssues.length === 0
                ? "All clear"
                : `${priorityIssues.length} active queues`}
            </span>
          </div>

          {priorityIssues.length === 0 ? (
            <p className="mt-5 rounded border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-950">
              No urgent shipping exceptions are open. Label queue is calm. Weirdly
              beautiful.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
              {priorityIssues.map((issue, index) => (
                <article
                  key={issue.key}
                  className={`rounded border p-4 ${priorityTone(issue.severity)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest opacity-75">
                        Priority {index + 1}
                      </p>
                      <h3 className="mt-1 font-black">{issue.title}</h3>
                    </div>
                    <span className="rounded border border-current px-2 py-1 text-xs font-black">
                      {issue.count}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{issue.detail}</p>
                  <p className="mt-2 text-xs font-bold opacity-75">
                    Oldest: {shortDate(issue.oldestAt)}
                  </p>
                  <Link
                    href={issue.href}
                    className="mt-3 inline-flex rounded bg-neutral-950 px-3 py-2 text-xs font-black text-white"
                  >
                    {issue.cta}
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded border bg-white">
            <div className="border-b p-5">
              <h2 className="text-2xl font-black">Label Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Latest prepared or provider-attempted label records.
              </p>
            </div>

            <div className="divide-y">
              {labels.length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">
                  No shipping label records have been prepared yet.
                </p>
              ) : (
                labels.map((row) => {
                  const order = orderFor(ordersById, row);
                  const policyNote = standardEnvelopePolicyNote(row);
                  const dryRun = isDryRunLabel(row);
                  const adapterProfile = shippingAdapterProfileDetails(row.metadata);

                  return (
                    <article
                      key={row.id}
                      className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/orders/${row.order_id}`}
                            className="text-lg font-black underline"
                          >
                            Order #{row.order_id}
                          </Link>
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                              row.label_status,
                            )}`}
                          >
                            {label(row.label_status)}
                          </span>
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                              row.coverage_status,
                            )}`}
                          >
                            Coverage {label(row.coverage_status)}
                          </span>
                          {dryRun ? (
                            <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black text-red-900">
                              DRY-RUN / DO NOT MAIL
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-neutral-600">
                          {order?.customer_email || "No customer email"} /{" "}
                          {row.provider_service || order?.shipping_name || "Shipping"}
                        </p>
                        {dryRun ? (
                          <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm font-black text-red-950">
                            Simulated shipping record only. No real postage,
                            USPS label, or external Coverage policy was
                            purchased.
                          </p>
                        ) : null}
                        {policyNote ? (
                          <p className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-sm font-semibold text-blue-950">
                            {policyNote}
                          </p>
                        ) : null}
                        {adapterProfile ? (
                          <div className="mt-2 rounded border border-purple-200 bg-purple-50 p-2 text-sm text-purple-950">
                            <p className="font-black">
                              Adapter: {label(adapterProfile.adapter)} /{" "}
                              {label(adapterProfile.status)}
                            </p>
                            <p className="mt-1 font-semibold">
                              {adapterProfile.provider} -{" "}
                              {adapterProfile.service} -{" "}
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
                        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-4">
                          <Info label="Provider" value={row.provider || "Pending"} />
                          <Info
                            label="Requested"
                            value={label(row.requested_shipping_method)}
                          />
                          <Info
                            label="Resolved"
                            value={label(row.resolved_shipping_method)}
                          />
                          <Info
                            label="Carrier"
                            value={row.carrier || order?.carrier || "Pending"}
                          />
                          <Info
                            label="Tracking"
                            value={
                              row.tracking_number ||
                              order?.tracking_number ||
                              "Pending"
                            }
                          />
                          <Info label="Postage" value={money(row.postage_amount)} />
                          <Info
                            label="Coverage"
                            value={`${row.coverage_provider || "Coverage"} ${money(
                              row.coverage_amount,
                            )}`}
                          />
                          <Info
                            label="Policy"
                            value={row.coverage_policy_id || "Pending"}
                          />
                          <Info label="Order Total" value={money(order?.total)} />
                          <Info label="Updated" value={shortDate(row.updated_at || row.created_at)} />
                        </dl>
                      </div>

                      <div className="flex items-start lg:justify-end">
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <a
                            href={`/api/admin/shipping-labels/${row.id}/packet`}
                            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-950"
                          >
                            Label Packet
                          </a>
                          <Link
                            href={`/admin/orders/${row.order_id}`}
                            className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white"
                          >
                            Open Order
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <Panel title="Blocked Purchase Attempts">
              {blockedEvents.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No blocked provider-purchase attempts recorded.
                </p>
              ) : (
                blockedEvents.slice(0, 8).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))
              )}
            </Panel>

            <Panel title="Manual Shipping Records">
              {manualRecordEvents.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No manual label purchases or external voids recorded.
                </p>
              ) : (
                manualRecordEvents.slice(0, 8).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))
              )}
            </Panel>

            <Panel title="Ready To Mark Shipped">
              {readyToMarkShippedLabels.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No purchased/printed labels are waiting for the order to be
                  marked shipped.
                </p>
              ) : (
                readyToMarkShippedLabels.slice(0, 8).map((row) => (
                  <LabelIssueCard
                    key={row.id}
                    row={row}
                    order={orderFor(ordersById, row)}
                    message="Label has tracking, but the order is not marked shipped."
                    tone="text-amber-900"
                    showMarkShippedAction
                  />
                ))
              )}
            </Panel>

            <Panel title="Tracking Missing">
              {trackingMissingLabels.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No purchased/printed labels are missing tracking.
                </p>
              ) : (
                trackingMissingLabels.slice(0, 8).map((row) => (
                  <LabelIssueCard
                    key={row.id}
                    row={row}
                    order={orderFor(ordersById, row)}
                    message="Label is purchased/printed, but no tracking or IMb is saved."
                    tone="text-red-900"
                    showSaveTrackingAction
                  />
                ))
              )}
            </Panel>

            <Panel title="Coverage Policy Missing">
              {coveragePolicyMissingLabels.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No purchased/printed labels are missing Coverage policy IDs.
                </p>
              ) : (
                coveragePolicyMissingLabels.slice(0, 8).map((row) => (
                  <LabelIssueCard
                    key={row.id}
                    row={row}
                    order={orderFor(ordersById, row)}
                    message="Label is purchased/printed, but Coverage policy details are incomplete."
                    tone="text-amber-900"
                    showSaveCoveragePolicyAction
                  />
                ))
              )}
            </Panel>

            <Panel title="Replacement Needed">
              {replacementNeededLabels.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No voided labels are waiting for a replacement.
                </p>
              ) : (
                replacementNeededLabels.slice(0, 8).map((row) => (
                  <LabelIssueCard
                    key={row.id}
                    row={row}
                    order={orderFor(ordersById, row)}
                    message="Label was voided and no newer active label is recorded."
                    tone="text-red-900"
                  />
                ))
              )}
            </Panel>

            <Panel title="Coverage Claims">
              {claims.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No coverage claims opened.
                </p>
              ) : (
                claims.slice(0, 8).map((claim) => (
                  <div key={claim.id} className="border-b py-3 last:border-b-0">
                    <Link
                      href={`/admin/orders/${claim.order_id}`}
                      className="font-bold underline"
                    >
                      Order #{claim.order_id}
                    </Link>
                    <p className="mt-1 text-sm text-neutral-600">
                      {label(claim.claim_type)} / {money(claim.claim_amount)}
                    </p>
                    <p
                      className={`mt-2 inline-block rounded border px-2 py-1 text-xs font-black ${statusTone(
                        claim.claim_status,
                      )}`}
                    >
                      {label(claim.claim_status)}
                    </p>
                    {claim.reason ? (
                      <p className="mt-2 text-sm">{claim.reason}</p>
                    ) : null}
                    <ShippingClaimActions
                      claimId={claim.id}
                      claimStatus={claim.claim_status}
                      providerClaimId={claim.provider_claim_id}
                    />
                  </div>
                ))
              )}
            </Panel>
          </aside>
        </section>

        <section className="rounded border bg-white">
          <div className="border-b p-5">
            <h2 className="text-2xl font-black">Recent Tracking Events</h2>
          </div>
          <div className="grid grid-cols-1 gap-0 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="divide-y">
              {events.slice(0, 12).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
              {events.length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">
                  No shipping tracking events yet.
                </p>
              ) : null}
            </div>
            <div className="p-5">
              <h3 className="font-black">What this page is for</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-700">
                <li>Find labels stuck at planned or purchase pending.</li>
                <li>See when provider purchase is blocked by missing secrets.</li>
                <li>Audit manually purchased labels and externally voided labels.</li>
                <li>Find purchased labels that still need tracking saved.</li>
                <li>Find purchased labels still missing Coverage policy IDs.</li>
                <li>Find purchased labels ready for order shipment marking.</li>
                <li>Spot voided shipments that still need replacement labels.</li>
                <li>Watch Coverage claim work without opening each order.</li>
                <li>Jump straight into the order cockpit to resolve shipping.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-white p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-neutral-500">{label}</dt>
      <dd className="break-words font-bold">{value}</dd>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border bg-white p-5">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function LabelIssueCard({
  row,
  order,
  message,
  tone,
  showMarkShippedAction = false,
  showSaveTrackingAction = false,
  showSaveCoveragePolicyAction = false,
}: {
  row: ShippingLabelRow;
  order: OrderRow | null;
  message: string;
  tone: string;
  showMarkShippedAction?: boolean;
  showSaveTrackingAction?: boolean;
  showSaveCoveragePolicyAction?: boolean;
}) {
  const carrier = row.carrier || order?.carrier || "";
  const trackingNumber = row.tracking_number || order?.tracking_number || "";
  const dryRun = isDryRunLabel(row);

  return (
    <div className="border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/orders/${row.order_id}`} className="font-bold underline">
          Order #{row.order_id}
        </Link>
        <span
          className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
            row.label_status,
          )}`}
        >
          {label(row.label_status)}
        </span>
        {dryRun ? (
          <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black text-red-900">
            DRY-RUN
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        {order?.customer_email || "No customer email"} /{" "}
        {row.provider_service || order?.shipping_name || "Shipping"}
      </p>
      {dryRun ? (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs font-black text-red-950">
          Simulated only — do not mail using this tracking, label, or Coverage
          policy.
        </p>
      ) : null}
      <p className={`mt-2 text-sm font-semibold ${tone}`}>{message}</p>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-neutral-600">
        <Info
          label="Tracking"
          value={row.tracking_number || order?.tracking_number || "Missing"}
        />
        <Info label="Coverage Policy" value={row.coverage_policy_id || "Missing"} />
        <Info label="Updated" value={shortDate(row.updated_at || row.created_at)} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {showSaveCoveragePolicyAction ? (
          <SaveCoveragePolicyForm
            labelId={row.id}
            defaultProvider={row.coverage_provider || "Coverage"}
            defaultAmount={String(row.coverage_amount || order?.total || "")}
          />
        ) : null}
        {showSaveTrackingAction ? (
          <SaveTrackingForm
            orderId={row.order_id}
            defaultCarrier={row.carrier || order?.carrier || "USPS"}
          />
        ) : null}
        {showMarkShippedAction && carrier && trackingNumber ? (
          <MarkOrderShippedButton
            orderId={row.order_id}
            carrier={carrier}
            trackingNumber={trackingNumber}
          />
        ) : null}
        <a
          href={`/api/admin/shipping-labels/${row.id}/packet`}
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950"
        >
          Label Packet
        </a>
        <Link
          href={`/admin/orders/${row.order_id}`}
          className="rounded bg-neutral-950 px-3 py-2 text-xs font-black text-white"
        >
          Open Order
        </Link>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: TrackingEventRow }) {
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/orders/${event.order_id}`} className="font-bold underline">
          Order #{event.order_id}
        </Link>
        <span
          className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
            event.event_status,
          )}`}
        >
          {label(event.event_status)}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold">{label(event.event_type)}</p>
      <p className="mt-1 text-sm text-neutral-600">
        {event.message || event.event_code || "Tracking update"}
      </p>
      <p className="mt-2 text-xs font-bold text-neutral-500">
        {shortDate(event.occurred_at)}
        {event.location ? ` / ${event.location}` : ""}
      </p>
    </div>
  );
}
