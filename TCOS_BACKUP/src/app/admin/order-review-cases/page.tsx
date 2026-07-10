import Link from "next/link";
import { getAccountProfilesByIds } from "../../../lib/account-profiles";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getActiveStoreId } from "../../../lib/stores";
import CaseQueueActions from "./CaseQueueActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const finalCaseStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);

const statusFilters = [
  ["active", "Active"],
  ["open", "Open"],
  ["evidence_gathering", "Evidence"],
  ["waiting_on_buyer", "Buyer"],
  ["waiting_on_seller", "Seller"],
  ["under_review", "Review"],
  ["appealed", "Appealed"],
  ["closed", "Closed"],
  ["all", "All"],
];

const typeFilters = [
  ["all", "All Types"],
  ["chargeback", "Chargebacks"],
  ["return", "Returns"],
  ["authenticity", "Authenticity"],
  ["item_not_as_described", "Not As Described"],
  ["payment_risk", "Payment Risk"],
  ["shipping_issue", "Shipping"],
  ["seller_dispute", "Seller Disputes"],
  ["other", "Other"],
];

const severityFilters = [
  ["all", "All Severity"],
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

type SearchParams = {
  status?: string;
  type?: string;
  severity?: string;
};

type OrderReviewCase = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  case_type: string | null;
  status: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  hold_seller_payouts: boolean | null;
  hold_order_fulfillment: boolean | null;
  outcome_summary: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type OrderRow = {
  id: number;
  account_id?: string | null;
  customer_email: string | null;
  total: number | string | null;
  status: string | null;
  fulfillment_status: string | null;
  contains_seller_items?: boolean | null;
  seller_item_count?: number | null;
  store_item_count?: number | null;
  created_at: string | null;
};

type SellerPayoutLedgerRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
};

type EvidenceReport = {
  id: string;
  order_id: number;
  status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string | null;
};

type OrderReviewCaseEvent = {
  id: string;
  case_id: string;
  event_type: string | null;
  previous_status: string | null;
  new_status: string | null;
  note: string | null;
  ip_address: string | null;
  identity_risk: string | null;
  created_at: string | null;
};

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
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

function statusTone(status: string | null | undefined) {
  if (status === "decided_for_seller" || status === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    status === "open" ||
    status === "evidence_gathering" ||
    status === "waiting_on_buyer" ||
    status === "waiting_on_seller" ||
    status === "under_review" ||
    status === "appealed" ||
    status === "hold_dispute_or_review" ||
    status === "hold_pending_fulfillment"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "decided_for_buyer" || status === "reversed") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function severityTone(severity: string | null | undefined) {
  if (severity === "critical") return "border-rose-300 bg-rose-50 text-rose-900";
  if (severity === "high") return "border-orange-200 bg-orange-50 text-orange-900";
  if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function isMissingCaseTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("order_review_cases")
  );
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is number => Number.isFinite(value))),
  );
}

function filterHref(params: SearchParams, patch: SearchParams) {
  const next = new URLSearchParams();
  const merged = { ...params, ...patch };

  for (const [key, value] of Object.entries(merged)) {
    if (!value || value === "active" || value === "all") continue;
    next.set(key, value);
  }

  const query = next.toString();
  return query ? `/admin/order-review-cases?${query}` : "/admin/order-review-cases";
}

function isCaseVisible(reviewCase: OrderReviewCase, params: Required<SearchParams>) {
  const status = reviewCase.status || "open";
  const type = reviewCase.case_type || "other";
  const severity = reviewCase.severity || "medium";

  const statusMatches =
    params.status === "all" ||
    (params.status === "active" && !finalCaseStatuses.has(status)) ||
    status === params.status;
  const typeMatches = params.type === "all" || type === params.type;
  const severityMatches =
    params.severity === "all" || severity === params.severity;

  return statusMatches && typeMatches && severityMatches;
}

function latestByOrder(reports: EvidenceReport[]) {
  const reportsByOrder = new Map<number, EvidenceReport>();

  for (const report of reports) {
    if (!reportsByOrder.has(report.order_id)) {
      reportsByOrder.set(report.order_id, report);
    }
  }

  return reportsByOrder;
}

function latestEventsByCase(events: OrderReviewCaseEvent[]) {
  const eventsByCase = new Map<string, OrderReviewCaseEvent>();

  for (const event of events) {
    if (!eventsByCase.has(event.case_id)) {
      eventsByCase.set(event.case_id, event);
    }
  }

  return eventsByCase;
}

function payoutScope(
  reviewCase: OrderReviewCase,
  payoutRows: SellerPayoutLedgerRow[],
) {
  const scopedRows = payoutRows.filter((row) => {
    if (row.order_id !== reviewCase.order_id) return false;
    if (!reviewCase.seller_account_id) return true;
    return row.seller_account_id === reviewCase.seller_account_id;
  });
  const heldRows = scopedRows.filter((row) =>
    String(row.payout_status || "").startsWith("hold_"),
  );
  const payableTotal = scopedRows.reduce(
    (sum, row) => sum + Number(row.seller_payable_amount || 0),
    0,
  );

  return {
    scopedRows,
    heldRows,
    payableTotal,
  };
}

export default async function AdminOrderReviewCasesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const resolvedParams = await searchParams;
  const activeFilters: Required<SearchParams> = {
    status: resolvedParams?.status || "active",
    type: resolvedParams?.type || "all",
    severity: resolvedParams?.severity || "all",
  };
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("order_review_cases")
    .select(
      `
      id,
      order_id,
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
      created_at,
      updated_at
    `,
    )
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (error) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-8 text-neutral-950">
        <div className="mx-auto max-w-5xl rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <Link href="/admin" className="text-sm font-black underline">
            Back to Command Center
          </Link>
          <h1 className="mt-4 text-3xl font-black">
            Order Review Cases Unavailable
          </h1>
          <p className="mt-3 text-sm font-semibold">
            {isMissingCaseTable(error)
              ? "Apply the order review case migration before using the global case queue."
              : error.message}
          </p>
          <p className="mt-3 rounded border border-amber-300 bg-white p-3 font-mono text-sm">
            supabase/migrations/20260701215000_create_order_review_cases.sql
          </p>
        </div>
      </main>
    );
  }

  const cases = (data || []) as OrderReviewCase[];
  const orderIds = uniqueNumbers(cases.map((reviewCase) => reviewCase.order_id));
  const [
    ordersResult,
    payoutLedgerResult,
    evidenceResult,
    caseEventsResult,
  ] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select(
            "id,account_id,customer_email,total,status,fulfillment_status,contains_seller_items,seller_item_count,store_item_count,created_at",
          )
          .eq("store_id", storeId)
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length > 0
      ? supabase
          .from("seller_payout_ledger_entries")
          .select(
            "id,order_id,seller_account_id,seller_payable_amount,payout_status",
          )
          .eq("store_id", storeId)
          .in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length > 0
      ? supabase
          .from("transaction_evidence_reports")
          .select("id,order_id,status,email_sent_at,email_error,created_at")
          .eq("store_id", storeId)
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    cases.length > 0
      ? supabase
          .from("order_review_case_events")
          .select(
            "id,case_id,event_type,previous_status,new_status,note,ip_address,identity_risk,created_at",
          )
          .eq("store_id", storeId)
          .in(
            "case_id",
            cases.map((reviewCase) => reviewCase.id),
          )
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const orders = (ordersResult.data || []) as OrderRow[];
  const payoutRows =
    (payoutLedgerResult.data || []) as SellerPayoutLedgerRow[];
  const evidenceReports = (evidenceResult.data || []) as EvidenceReport[];
  const caseEvents = (caseEventsResult.data || []) as OrderReviewCaseEvent[];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const evidenceByOrder = latestByOrder(evidenceReports);
  const latestEventByCase = latestEventsByCase(caseEvents);
  const profilesById = await getAccountProfilesByIds([
    ...cases.map((reviewCase) => reviewCase.seller_account_id),
    ...orders.map((order) => order.account_id),
    ...payoutRows.map((row) => row.seller_account_id),
  ]);

  const visibleCases = cases.filter((reviewCase) =>
    isCaseVisible(reviewCase, activeFilters),
  );
  const activeCases = cases.filter(
    (reviewCase) => !finalCaseStatuses.has(reviewCase.status || "open"),
  );
  const criticalCases = activeCases.filter(
    (reviewCase) => reviewCase.severity === "critical",
  );
  const waitingCases = activeCases.filter((reviewCase) =>
    ["waiting_on_buyer", "waiting_on_seller"].includes(
      reviewCase.status || "",
    ),
  );
  const heldPayoutCases = activeCases.filter((reviewCase) => {
    const scope = payoutScope(reviewCase, payoutRows);
    return scope.heldRows.length > 0;
  });

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Admin
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Order Review Case Queue
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Chargebacks, returns, authenticity claims, payment risk, shipping
              issues, seller disputes, payout holds, and case outcomes.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Command Center
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Orders
            </Link>
            <Link
              href="/admin/seller-payouts"
              className="rounded-md bg-amber-300 px-4 py-2 text-sm font-bold text-neutral-950 hover:bg-amber-200"
            >
              Payouts
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {ordersResult.error || payoutLedgerResult.error || evidenceResult.error || caseEventsResult.error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            <h2 className="text-xl font-black">Some Case Context Is Missing</h2>
            <p className="mt-2">
              {ordersResult.error?.message ||
                payoutLedgerResult.error?.message ||
                evidenceResult.error?.message ||
                caseEventsResult.error?.message}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricTile
            label="Active Cases"
            value={String(activeCases.length)}
            detail={`${cases.length} total case file(s)`}
          />
          <MetricTile
            label="Critical"
            value={String(criticalCases.length)}
            detail="Active critical severity cases"
          />
          <MetricTile
            label="Waiting"
            value={String(waitingCases.length)}
            detail="Waiting on buyer or seller"
          />
          <MetricTile
            label="Payout Holds"
            value={String(heldPayoutCases.length)}
            detail="Active cases with held seller payout rows"
          />
          <MetricTile
            label="Visible"
            value={String(visibleCases.length)}
            detail="Cases matching current filters"
          />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-black">Filters</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Narrow the queue by case status, type, and severity.
              </p>
            </div>

            <FilterGroup
              label="Status"
              filters={statusFilters}
              activeValue={activeFilters.status}
              hrefFor={(value) => filterHref(activeFilters, { status: value })}
            />
            <FilterGroup
              label="Type"
              filters={typeFilters}
              activeValue={activeFilters.type}
              hrefFor={(value) => filterHref(activeFilters, { type: value })}
            />
            <FilterGroup
              label="Severity"
              filters={severityFilters}
              activeValue={activeFilters.severity}
              hrefFor={(value) => filterHref(activeFilters, { severity: value })}
            />
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Case Files</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Global admin view for every order-level case file.
            </p>
          </div>

          {visibleCases.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No cases match the current filters.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {visibleCases.map((reviewCase) => {
                const order = ordersById.get(reviewCase.order_id);
                const sellerProfile = reviewCase.seller_account_id
                  ? profilesById.get(reviewCase.seller_account_id)
                  : undefined;
                const buyerProfile = order?.account_id
                  ? profilesById.get(order.account_id)
                  : undefined;
                const evidence = evidenceByOrder.get(reviewCase.order_id);
                const latestEvent = latestEventByCase.get(reviewCase.id);
                const payout = payoutScope(reviewCase, payoutRows);
                const sellerLabel =
                  sellerProfile?.display_name ||
                  sellerProfile?.email ||
                  reviewCase.seller_account_id ||
                  "All seller-owned rows";

                return (
                  <article
                    key={reviewCase.id}
                    className="grid gap-5 p-5 xl:grid-cols-[1fr_0.95fr_320px]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge
                          labelText={label(reviewCase.status)}
                          className={statusTone(reviewCase.status)}
                        />
                        <StatusBadge
                          labelText={label(reviewCase.severity)}
                          className={severityTone(reviewCase.severity)}
                        />
                        <StatusBadge
                          labelText={label(reviewCase.case_type)}
                          className="border-neutral-200 bg-neutral-100 text-neutral-700"
                        />
                      </div>

                      <h3 className="mt-3 text-xl font-black">
                        {reviewCase.title || `Order #${reviewCase.order_id} case`}
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
                        {reviewCase.description || "No case description saved."}
                      </p>

                      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                        <InfoBlock
                          labelText="Opened"
                          value={shortDate(reviewCase.opened_at)}
                        />
                        <InfoBlock
                          labelText="Updated"
                          value={shortDate(reviewCase.updated_at)}
                        />
                        <InfoBlock
                          labelText="Closed"
                          value={shortDate(reviewCase.closed_at)}
                        />
                      </dl>

                      {reviewCase.outcome_summary ? (
                        <p className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
                          <strong>Outcome:</strong>{" "}
                          {reviewCase.outcome_summary}
                        </p>
                      ) : null}

                      {latestEvent ? (
                        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
                          <p className="font-black">
                            Latest Event: {label(latestEvent.event_type)}
                          </p>
                          <p className="mt-1 text-xs text-neutral-600">
                            {label(latestEvent.previous_status)} {" -> "}
                            {label(latestEvent.new_status)} /{" "}
                            {shortDate(latestEvent.created_at)} / IP{" "}
                            {latestEvent.ip_address || "not recorded"} /{" "}
                            {label(latestEvent.identity_risk)}
                          </p>
                          <p className="mt-2 text-neutral-700">
                            {latestEvent.note || "No event note."}
                          </p>
                        </div>
                      ) : null}

                      <a
                        href={`/api/admin/order-review-cases/${reviewCase.id}/packet`}
                        className="mt-4 inline-block rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
                      >
                        Download Case Packet PDF
                      </a>
                    </div>

                    <div className="space-y-4 text-sm">
                      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <h4 className="font-black">Order</h4>
                        <Link
                          href={`/admin/orders/${reviewCase.order_id}`}
                          className="mt-2 inline-block font-black underline"
                        >
                          Order #{reviewCase.order_id}
                        </Link>
                        <dl className="mt-3 grid grid-cols-2 gap-3">
                          <InfoBlock
                            labelText="Total"
                            value={money(order?.total)}
                          />
                          <InfoBlock
                            labelText="Payment"
                            value={label(order?.status)}
                          />
                          <InfoBlock
                            labelText="Fulfillment"
                            value={label(order?.fulfillment_status)}
                          />
                          <InfoBlock
                            labelText="Seller Items"
                            value={String(order?.seller_item_count || 0)}
                          />
                        </dl>
                        <p className="mt-3 break-words text-neutral-700">
                          Buyer:{" "}
                          <strong>
                            {buyerProfile?.email ||
                              buyerProfile?.display_name ||
                              order?.customer_email ||
                              "Not saved"}
                          </strong>
                        </p>
                      </section>

                      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <h4 className="font-black">Seller And Payout Hold</h4>
                        <p className="mt-2 break-all font-semibold">
                          {sellerLabel}
                        </p>
                        <dl className="mt-3 grid grid-cols-2 gap-3">
                          <InfoBlock
                            labelText="Rows"
                            value={String(payout.scopedRows.length)}
                          />
                          <InfoBlock
                            labelText="Held"
                            value={String(payout.heldRows.length)}
                          />
                          <InfoBlock
                            labelText="Payable"
                            value={money(payout.payableTotal)}
                          />
                          <InfoBlock
                            labelText="Hold Flag"
                            value={reviewCase.hold_seller_payouts ? "Yes" : "No"}
                          />
                        </dl>
                      </section>

                      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <h4 className="font-black">Evidence</h4>
                        {evidence ? (
                          <>
                            <p className="mt-2 text-neutral-700">
                              {label(evidence.status)} /{" "}
                              {evidence.email_sent_at
                                ? "Email sent"
                                : evidence.email_error || "Not emailed"}
                            </p>
                            <a
                              href={`/api/admin/files/${evidence.id}/download`}
                              className="mt-3 inline-block rounded-md border border-neutral-300 bg-white px-3 py-2 font-black hover:bg-neutral-50"
                            >
                              Download Evidence PDF
                            </a>
                          </>
                        ) : (
                          <p className="mt-2 text-neutral-600">
                            No evidence packet found for this order yet.
                          </p>
                        )}
                      </section>
                    </div>

                    <aside className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                      <h4 className="mb-3 font-black">Update Case</h4>
                      <CaseQueueActions
                        key={`${reviewCase.id}-${reviewCase.status || "open"}-${
                          reviewCase.updated_at || ""
                        }`}
                        caseId={reviewCase.id}
                        status={reviewCase.status}
                        outcomeSummary={reviewCase.outcome_summary}
                        heldRowCount={payout.heldRows.length}
                        payoutRowCount={payout.scopedRows.length}
                        payableTotal={payout.payableTotal}
                      />
                    </aside>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Recent Case Activity</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Latest event records across the active store.
            </p>
          </div>

          {caseEvents.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No case events recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {caseEvents.slice(0, 20).map((event) => (
                <div
                  key={event.id}
                  className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_1fr_auto]"
                >
                  <div>
                    <p className="font-black">{label(event.event_type)}</p>
                    <p className="mt-1 break-all text-xs text-neutral-600">
                      Case {event.case_id}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold">
                      {label(event.previous_status)} {" -> "}
                      {label(event.new_status)}
                    </p>
                    <p className="mt-1 text-neutral-700">
                      {event.note || "No note."}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-neutral-500 md:text-right">
                    {shortDate(event.created_at)}
                    <br />
                    IP {event.ip_address || "not recorded"} /{" "}
                    {label(event.identity_risk)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-neutral-600">{detail}</p>
    </div>
  );
}

function FilterGroup({
  label,
  filters,
  activeValue,
  hrefFor,
}: {
  label: string;
  filters: string[][];
  activeValue: string;
  hrefFor: (value: string) => string;
}) {
  return (
    <div>
      <p className="text-sm font-black uppercase text-neutral-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {filters.map(([value, filterLabel]) => (
          <Link
            key={value}
            href={hrefFor(value)}
            className={
              value === activeValue
                ? "rounded-md bg-neutral-950 px-3 py-2 text-sm font-black text-white"
                : "rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-bold hover:bg-white"
            }
          >
            {filterLabel}
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({
  labelText,
  className,
}: {
  labelText: string;
  className: string;
}) {
  return (
    <span className={`rounded border px-2 py-1 text-xs font-black ${className}`}>
      {labelText}
    </span>
  );
}

function InfoBlock({
  labelText,
  value,
}: {
  labelText: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-black uppercase text-neutral-500">
        {labelText}
      </dt>
      <dd className="mt-1 break-words font-bold text-neutral-900">{value}</dd>
    </div>
  );
}
