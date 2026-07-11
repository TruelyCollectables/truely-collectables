import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { getAccountProfilesByIds } from "../../../../lib/account-profiles";
import { isOrderReviewStatus } from "../../../../lib/order-status";
import { isDryRunShippingLabel as isDryRunShippingLabelRecord } from "../../../../lib/shipping-dry-run";
import { getShippingProviderReadiness } from "../../../../lib/shipping-provider-readiness";
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
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { id } = await params;
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
      <main className="p-8">
        <h1 className="text-3xl font-bold">Order Not Found</h1>
        <pre>{error?.message}</pre>
        <Link href="/admin/orders" className="underline">
          Back to Fulfillment Center
        </Link>
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
  const { data: platformFeeLedgerEntries } = await supabase
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
  const platformFeeLedger =
    (platformFeeLedgerEntries || []) as PlatformFeeLedgerEntry[];
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
      .limit(20);
  const shippingTrackingEvents = shippingTrackingEventsError
    ? []
    : ((shippingTrackingEventsData || []) as ShippingTrackingEvent[]);
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

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <Link href="/admin/orders" className="underline">
          ← Back to Fulfillment Center
        </Link>

        <h1 className="text-4xl font-bold mt-4">Order #{typedOrder.id}</h1>

        <p className="text-gray-600">
          Created {new Date(typedOrder.created_at).toLocaleString()}
        </p>
      </div>

      {needsReview ? (
        <section className="mb-6 rounded border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <h2 className="text-xl font-bold">Order Needs Review</h2>
          <p className="mt-2 text-sm font-semibold">{reviewMessage}</p>
        </section>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Payment</p>
          <p className="text-2xl font-bold">{label(typedOrder.status)}</p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Fulfillment</p>
          <p className="text-2xl font-bold">
            {label(typedOrder.fulfillment_status)}
          </p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Items Total</p>
          <p className="text-2xl font-bold">{money(itemsTotal)}</p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Paid</p>
          <p className="text-2xl font-bold">{money(totalPaid)}</p>
        </div>
      </div>

      {platformFeeLedger.length > 0 ? (
        <section className="border rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">
            Dag Danky Holdings LLC Rake
          </h2>

          <div className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-500">
              8% Platform Rake Total
            </p>
            <p className="text-2xl font-bold">{money(allSiteRakeTotal)}</p>
            <p className="mt-1 text-sm text-gray-600">
              Calculated from this TCOS website checkout order only, using each
              order item plus allocated buyer-paid shipping.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {platformFeeLedger.map((entry) => (
              <div key={entry.id} className="rounded border p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-bold">
                      Order Item #{entry.order_item_id}
                    </p>
                    <p className="text-sm text-gray-600">
                      {entry.seller_account_id
                        ? `Outside seller ${entry.seller_account_id}`
                        : "Store inventory"}
                    </p>
                  </div>

                  <p className="text-sm font-bold">
                    Rate{" "}
                    {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}%
                  </p>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="font-semibold text-gray-500">Gross</dt>
                    <dd>{money(Number(entry.gross_item_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Shipping Basis
                    </dt>
                    <dd>
                      {money(Number(entry.shipping_allocated_amount || 0))}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Total Basis
                    </dt>
                    <dd>{money(Number(entry.total_basis_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Dag Danky Holdings LLC Fee
                    </dt>
                    <dd>{money(Number(entry.platform_fee_amount || 0))}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <section className="border rounded-lg p-4 mb-6 bg-amber-50 border-amber-200">
          <h2 className="text-lg font-bold">Seller Routing</h2>
          <p className="mt-2 text-sm font-semibold text-amber-900">
            This order contains {typedOrder.seller_item_count || 0} seller-routed item(s) and {typedOrder.store_item_count || 0} store-owned item(s).
          </p>
        </section>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <section className="border rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Seller Payout Ledger</h2>

          {payoutLedgerError ? (
            <p className="text-red-600">
              Payout ledger unavailable: {payoutLedgerError.message}
            </p>
          ) : sellerPayoutLedger.length === 0 ? (
            <p className="text-gray-600">
              No seller payout ledger entries have been created for this order yet.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-500">
                    Dag Danky Holdings LLC Fee Total
                  </p>
                  <p className="text-2xl font-bold">
                    {money(platformFeeTotal)}
                  </p>
                </div>

                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-500">
                    Seller Payable Total
                  </p>
                  <p className="text-2xl font-bold">
                    {money(sellerPayoutTotal)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {sellerPayoutLedger.map((entry) => (
                  <div key={entry.id} className="rounded border p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-bold">
                          Seller {entry.seller_account_id}
                        </p>
                        <p className="text-sm text-gray-600">
                          Order Item #{entry.order_item_id} -{" "}
                          {label(entry.payout_status)}
                        </p>
                      </div>

                      <p className="text-sm font-bold">
                        Rate{" "}
                        {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}
                        %
                      </p>
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                      <div>
                        <dt className="font-semibold text-gray-500">Gross</dt>
                        <dd>{money(Number(entry.gross_item_amount || 0))}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Shipping Basis
                        </dt>
                        <dd>
                          {money(Number(entry.shipping_allocated_amount || 0))}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Dag Danky Holdings LLC Fee
                        </dt>
                        <dd>{money(Number(entry.platform_fee_amount || 0))}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Seller Payable
                        </dt>
                        <dd>
                          {money(Number(entry.seller_payable_amount || 0))}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 max-w-xs">
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
        </section>
      ) : null}

      <OrderReviewCasesPanel
        orderId={typedOrder.id}
        cases={orderReviewCases}
        sellerOptions={sellerOptions}
        payoutRows={sellerPayoutLedger}
        tableError={orderReviewCasesError?.message || null}
        caseEvents={orderReviewCaseEvents}
        eventsError={orderReviewCaseEventsError?.message || null}
      />

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Customer</h2>
        <p>Name: {typedOrder.customer_name || "Not saved"}</p>
        <p>Email: {typedOrder.customer_email || "No email"}</p>
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
          <h3 className="font-bold">Linked TCOS Account</h3>
          {accountProfile ? (
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="font-semibold text-gray-500">Account Email</dt>
                <dd className="break-words">
                  {accountProfile.email || "Not saved"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Display Name</dt>
                <dd>{accountProfile.display_name || "Not saved"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Status</dt>
                <dd>{label(accountProfile.account_status)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Account Type</dt>
                <dd>{label(accountProfile.default_account_type)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="font-semibold text-gray-500">Account ID</dt>
                <dd className="break-all">{accountProfile.id}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              {typedOrder.account_id
                ? "This order has an account ID, but the account profile could not be loaded."
                : "Guest checkout. No TCOS account was linked to this order."}
            </p>
          )}
        </div>

        <div className="mt-4">
          <h3 className="font-bold">Customer Notes</h3>
          <p className="mt-1 whitespace-pre-wrap">
            {typedOrder.customer_notes?.trim() || "No customer notes."}
          </p>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Ship To</h2>

        {typedOrder.shipping_address_line1 ? (
          <div>
            <p>{typedOrder.customer_name || typedOrder.customer_email}</p>
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
          <p className="text-gray-600">Shipping address not saved.</p>
        )}
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Items</h2>

        {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
          <p>No order items found.</p>
        ) : (
          <div className="space-y-3">
            {typedOrder.order_items.map((item) => (
              <div key={item.id} className="flex justify-between border-b pb-3">
                <div>
                  <p className="font-bold">{item.title}</p>
                  <p className="text-xs font-semibold text-gray-500">
                    Owner: {item.seller_account_id || "Store inventory"}
                  </p>
                  <p className="text-sm text-gray-600">
                    Quantity: {item.quantity} × {money(item.price)}
                  </p>
                </div>

                <p className="font-bold">
                  {money(Number(item.price) * Number(item.quantity))}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Order Totals</h2>

        <div className="max-w-md space-y-2">
          <div className="flex justify-between">
            <span>Items Total</span>
            <strong>{money(itemsTotal)}</strong>
          </div>

          <div className="flex justify-between">
            <span>
              Discount
              {typedOrder.discount_code ? ` (${typedOrder.discount_code})` : ""}
            </span>
            <strong>-{money(discountAmount)}</strong>
          </div>

          <div className="flex justify-between">
            <span>Shipping Paid</span>
            <strong>{money(shippingPaid)}</strong>
          </div>

          <div className="flex justify-between border-t pt-3 text-xl">
            <span>Total Paid</span>
            <strong>{money(totalPaid)}</strong>
          </div>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Shipping</h2>

        <p>Method: {typedOrder.shipping_name || typedOrder.shipping_method}</p>
        <p>Shipping Paid: {money(typedOrder.shipping_amount)}</p>
        <p>Items: {typedOrder.item_count || 0}</p>

        <div className="mt-4">
          <p>Carrier: {typedOrder.carrier || "Not added"}</p>
          <p>Tracking: {typedOrder.tracking_number || "Not added"}</p>
          <p>
            Shipped At:{" "}
            {typedOrder.shipped_at
              ? new Date(typedOrder.shipped_at).toLocaleString()
              : "Not shipped"}
          </p>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Shipping Label + Coverage</h2>
            <p className="mt-1 text-sm font-semibold text-gray-600">
              Provider-ready records for label purchase, shipment tracking, and
              seller protection coverage.
            </p>
          </div>

          <ShippingLabelActions
            orderId={typedOrder.id}
            activeDryRunLabel={activeDryRunShippingLabel}
          />
        </div>

        {shippingLabelsError ? (
          <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Shipping label tables are not available yet:{" "}
            {shippingLabelsError.message}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {shippingProviderReadiness.map((item) => (
            <div
              key={item.key}
              className={`rounded border p-4 ${
                item.status === "ready"
                  ? "border-green-200 bg-green-50 text-green-950"
                  : item.status === "blocked"
                    ? "border-red-200 bg-red-50 text-red-950"
                    : "border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-black">{item.label}</h3>
                <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
                  {label(item.status)}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold">{item.detail}</p>
              <p className="mt-2 text-xs font-bold">{item.action}</p>
            </div>
          ))}
        </div>

        {!shippingLabelsError && shippingLabels.length === 0 ? (
          <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            No label record has been prepared yet. Preparing one does not buy a
            live label; it creates the TCOS audit record that the provider
            adapter will later purchase against.
          </div>
        ) : !shippingLabelsError ? (
          <div className="mt-4 space-y-4">
            {shippingLabels.map((shippingLabel) => {
              const policyNote = standardEnvelopePolicyNote(shippingLabel);
              const dryRun = isDryRunShippingLabel(
                shippingLabel,
                shippingTrackingEvents,
              );
              const adapterProfile =
                shippingAdapterProfileDetails(shippingLabel.metadata);

              return (
              <div key={shippingLabel.id} className="rounded border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black">
                        {shippingLabel.provider_service ||
                          typedOrder.shipping_name ||
                          "Shipping Label"}
                      </p>
                      {dryRun ? (
                        <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black text-red-900">
                          DRY-RUN / DO NOT MAIL
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold text-gray-600">
                      Status: {label(shippingLabel.label_status)} / Coverage:{" "}
                      {label(shippingLabel.coverage_status)}
                    </p>
                    {dryRun ? (
                      <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-sm font-black text-red-950">
                        Simulated shipping record only. No real postage, USPS
                        label, or external Coverage policy was purchased.
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
                  </div>

                  <p className="rounded bg-gray-100 px-3 py-1 text-xs font-black">
                    {shippingLabel.provider || "Provider pending"}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="font-semibold text-gray-500">Service</dt>
                    <dd>{label(shippingLabel.resolved_shipping_method)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Requested</dt>
                    <dd>{label(shippingLabel.requested_shipping_method)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Resolved</dt>
                    <dd>{label(shippingLabel.resolved_shipping_method)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Carrier</dt>
                    <dd>{shippingLabel.carrier || "Pending"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Tracking</dt>
                    <dd className="break-all">
                      {shippingLabel.tracking_number || "Pending"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Postage</dt>
                    <dd>{money(Number(shippingLabel.postage_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Coverage Provider
                    </dt>
                    <dd>{shippingLabel.coverage_provider || "Coverage"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Coverage Amount
                    </dt>
                    <dd>{money(Number(shippingLabel.coverage_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Policy ID</dt>
                    <dd className="break-all">
                      {shippingLabel.coverage_policy_id || "Pending purchase"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">Created</dt>
                    <dd>{dateLabel(shippingLabel.created_at)}</dd>
                  </div>
                </dl>

                {shippingLabel.label_url || shippingLabel.label_pdf_url ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href={`/api/admin/shipping-labels/${shippingLabel.id}/packet`}
                      className="rounded border px-4 py-2 font-bold"
                    >
                      Download Label Packet
                    </a>
                    {shippingLabel.label_pdf_url ? (
                      <a
                        href={shippingLabel.label_pdf_url}
                        className="rounded border px-4 py-2 font-bold"
                      >
                        Open Label PDF
                      </a>
                    ) : null}
                    {shippingLabel.label_url ? (
                      <a
                        href={shippingLabel.label_url}
                        className="rounded border px-4 py-2 font-bold"
                      >
                        Open Label
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <a
                      href={`/api/admin/shipping-labels/${shippingLabel.id}/packet`}
                      className="inline-flex rounded border px-4 py-2 font-bold"
                    >
                      Download Label Packet
                    </a>
                    <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-950">
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
          <div className="rounded border p-4">
            <h3 className="font-black">Tracking Events</h3>
            {shippingTrackingEventsError ? (
              <p className="mt-2 text-sm font-semibold text-amber-700">
                Tracking event table unavailable:{" "}
                {shippingTrackingEventsError.message}
              </p>
            ) : shippingTrackingEvents.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">
                No tracking events have been recorded yet.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {shippingTrackingEvents.map((event) => (
                  <div key={event.id} className="border-b pb-3 last:border-b-0">
                    <p className="font-bold">
                      {label(event.event_type)} / {label(event.event_status)}
                    </p>
                    <p className="text-sm text-gray-600">
                      {event.message || event.event_code || "Tracking update"}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {dateLabel(event.occurred_at)}
                      {event.location ? ` / ${event.location}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border p-4">
            <h3 className="font-black">Coverage Claims</h3>
            {shippingCoverageClaimsError ? (
              <p className="mt-2 text-sm font-semibold text-amber-700">
                Coverage claim table unavailable:{" "}
                {shippingCoverageClaimsError.message}
              </p>
            ) : shippingCoverageClaims.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">
                No loss/damage coverage claims have been opened.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {shippingCoverageClaims.map((claim) => (
                  <div key={claim.id} className="border-b pb-3 last:border-b-0">
                    <p className="font-bold">
                      {claim.provider || "Coverage"} /{" "}
                      {label(claim.claim_status)}
                    </p>
                    <p className="text-sm text-gray-600">
                      {label(claim.claim_type)} for{" "}
                      {money(Number(claim.claim_amount || 0))}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
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
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs font-semibold text-gray-500">
          Active label records for this order: {shippingLabelIds.length}. This
          cockpit is the source of truth for future provider adapters.
        </p>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Chargeback Evidence</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-bold mb-2">Terms And Identity</h3>
            <p>TOS Accepted: {typedOrder.tos_accepted ? "Yes" : "No"}</p>
            <p>Version: {typedOrder.tos_version || "Not saved"}</p>
            <p>
              Accepted At:{" "}
              {typedOrder.tos_accepted_at
                ? new Date(typedOrder.tos_accepted_at).toLocaleString()
                : "Not saved"}
            </p>
            <p>IP Address: {typedOrder.tos_ip_address || "Not saved"}</p>
            <p>IP Risk: {typedOrder.tos_ip_risk || "Not saved"}</p>
            <p>
              Block Reason: {typedOrder.tos_ip_block_reason || "None saved"}
            </p>
            <p className="break-all">
              Acceptance Event:{" "}
              {typedOrder.tos_acceptance_event_id || "Not saved"}
            </p>
          </div>

          <div>
            <h3 className="font-bold mb-2">Evidence Packet</h3>

            {evidenceError ? (
              <p className="text-red-600">
                Evidence table unavailable: {evidenceError.message}
              </p>
            ) : latestEvidence ? (
              <>
                <p>Status: {latestEvidence.status || "ready"}</p>
                <p>
                  Created:{" "}
                  {new Date(latestEvidence.created_at).toLocaleString()}
                </p>
                <p>
                  Last Updated:{" "}
                  {latestEvidence.updated_at
                    ? new Date(latestEvidence.updated_at).toLocaleString()
                    : "Not saved"}
                </p>
                <p>
                  Email:{" "}
                  {latestEvidence.email_sent_at
                    ? `Sent to ${latestEvidence.emailed_to}`
                    : latestEvidence.email_error || "Not sent"}
                </p>

                <a
                  href={`/api/admin/files/${latestEvidence.id}/download`}
                  className="inline-block mt-4 border rounded px-4 py-2"
                >
                  Download Evidence PDF
                </a>
              </>
            ) : (
              <p className="text-gray-600">
                No evidence packet has been created for this order yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Add Tracking</h2>

        <TrackingForm
          orderId={typedOrder.id}
          currentCarrier={typedOrder.carrier || ""}
          currentTrackingNumber={typedOrder.tracking_number || ""}
          canMarkShipped={!needsReview}
          reviewMessage={needsReview ? reviewMessage : undefined}
          dryRunShippingBlocked={activeDryRunShippingLabel}
        />
      </section>

      <section className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Actions</h2>

        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/files"
            className="border rounded px-4 py-2"
          >
            Evidence Files
          </Link>

          <Link
            href={`/admin/orders/${typedOrder.id}/packing-slip`}
            className="border rounded px-4 py-2"
          >
            Print Packing Slip
          </Link>
        </div>
      </section>
    </main>
  );
}
