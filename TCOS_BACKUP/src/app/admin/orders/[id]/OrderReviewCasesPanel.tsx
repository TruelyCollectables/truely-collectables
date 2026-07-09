"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import CaseQueueActions from "../../order-review-cases/CaseQueueActions";

export type AdminOrderReviewCase = {
  id: string;
  seller_account_id: string | null;
  case_type: string;
  status: string;
  severity: string;
  title: string;
  description: string | null;
  hold_seller_payouts: boolean;
  hold_order_fulfillment: boolean;
  outcome_summary: string | null;
  opened_at: string;
  closed_at: string | null;
  updated_at: string | null;
};

export type SellerCaseOption = {
  id: string;
  label: string;
};

export type OrderReviewCasePayoutRow = {
  id: string;
  seller_account_id: string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
};

export type AdminOrderReviewCaseEvent = {
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

const caseTypeOptions = [
  ["chargeback", "Chargeback"],
  ["return", "Return"],
  ["authenticity", "Authenticity"],
  ["item_not_as_described", "Item Not As Described"],
  ["payment_risk", "Payment Risk"],
  ["shipping_issue", "Shipping Issue"],
  ["seller_dispute", "Seller Dispute"],
  ["other", "Other"],
];

const severityOptions = [
  ["medium", "Medium"],
  ["high", "High"],
  ["critical", "Critical"],
  ["low", "Low"],
];

const finalStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

function statusTone(status: string | null | undefined) {
  if (status === "decided_for_seller" || status === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "decided_for_buyer") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function severityTone(severity: string | null | undefined) {
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (severity === "high") {
    return "border-orange-200 bg-orange-50 text-orange-800";
  }

  if (severity === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function payoutScope(
  reviewCase: AdminOrderReviewCase,
  payoutRows: OrderReviewCasePayoutRow[],
) {
  const scopedRows = payoutRows.filter((row) => {
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

export default function OrderReviewCasesPanel({
  orderId,
  cases,
  sellerOptions,
  payoutRows,
  caseEvents,
  tableError,
  eventsError,
}: {
  orderId: number;
  cases: AdminOrderReviewCase[];
  sellerOptions: SellerCaseOption[];
  payoutRows: OrderReviewCasePayoutRow[];
  caseEvents: AdminOrderReviewCaseEvent[];
  tableError?: string | null;
  eventsError?: string | null;
}) {
  const router = useRouter();
  const [caseType, setCaseType] = useState("chargeback");
  const [severity, setSeverity] = useState("medium");
  const [sellerAccountId, setSellerAccountId] = useState("all");
  const [title, setTitle] = useState(`Order #${orderId} review`);
  const [description, setDescription] = useState("");
  const [holdSellerPayouts, setHoldSellerPayouts] = useState(true);
  const [holdOrderFulfillment, setHoldOrderFulfillment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sellerLabels = useMemo(
    () => new Map(sellerOptions.map((seller) => [seller.id, seller.label])),
    [sellerOptions],
  );
  const eventsByCase = useMemo(() => {
    const grouped = new Map<string, AdminOrderReviewCaseEvent[]>();

    for (const event of caseEvents) {
      const existing = grouped.get(event.case_id) || [];
      existing.push(event);
      grouped.set(event.case_id, existing);
    }

    return grouped;
  }, [caseEvents]);
  const activeCaseCount = useMemo(
    () => cases.filter((reviewCase) => !finalStatuses.has(reviewCase.status)).length,
    [cases],
  );

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/order-review-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          caseType,
          severity,
          sellerAccountId,
          title,
          description,
          holdSellerPayouts,
          holdOrderFulfillment,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not create order review case.");
      }

      setMessage(
        `Case opened. Seller payout rows held: ${data.sellerPayoutRowsHeld || 0}.`,
      );
      setDescription("");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Could not create order review case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded-lg p-6 mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Order Review Cases</h2>
          <p className="mt-1 text-sm text-gray-600">
            Chargebacks, returns, authenticity issues, shipping disputes, and
            seller payout holds for this order.
          </p>
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
          <span className="font-bold">{activeCaseCount}</span> active /{" "}
          <span className="font-bold">{cases.length}</span> total
        </div>
      </div>

      {tableError ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          Review case tables unavailable: {tableError}
        </div>
      ) : (
        <>
          {cases.length === 0 ? (
            <p className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              No order review cases have been opened for this order.
            </p>
          ) : (
            <div className="space-y-4">
              {cases.map((reviewCase) => {
                const sellerLabel = reviewCase.seller_account_id
                  ? sellerLabels.get(reviewCase.seller_account_id) ||
                    reviewCase.seller_account_id
                  : "All seller-owned rows";
                const payout = payoutScope(reviewCase, payoutRows);
                const recentEvents = eventsByCase.get(reviewCase.id) || [];

                return (
                  <article
                    key={`${reviewCase.id}-${reviewCase.status}-${reviewCase.updated_at || ""}`}
                    className="rounded border border-gray-200 bg-white p-5"
                  >
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`rounded border px-2 py-1 text-xs font-bold ${statusTone(reviewCase.status)}`}
                          >
                            {label(reviewCase.status)}
                          </span>
                          <span
                            className={`rounded border px-2 py-1 text-xs font-bold ${severityTone(reviewCase.severity)}`}
                          >
                            {label(reviewCase.severity)}
                          </span>
                          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold text-gray-700">
                            {label(reviewCase.case_type)}
                          </span>
                        </div>

                        <h3 className="mt-3 text-lg font-bold">
                          {reviewCase.title}
                        </h3>
                        <p className="mt-2 text-sm text-gray-600">
                          {reviewCase.description || "No description saved."}
                        </p>

                        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                          <div>
                            <dt className="font-semibold text-gray-500">
                              Seller Scope
                            </dt>
                            <dd className="break-words font-semibold text-gray-900">
                              {sellerLabel}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-500">Opened</dt>
                            <dd>{dateLabel(reviewCase.opened_at)}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-500">Updated</dt>
                            <dd>{dateLabel(reviewCase.updated_at)}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-500">Closed</dt>
                            <dd>{dateLabel(reviewCase.closed_at)}</dd>
                          </div>
                        </dl>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                            <p className="font-bold text-gray-900">Hold Flags</p>
                            <p className="mt-2 text-gray-700">
                              Seller payout hold:{" "}
                              <strong>
                                {reviewCase.hold_seller_payouts ? "Yes" : "No"}
                              </strong>
                            </p>
                            <p className="mt-1 text-gray-700">
                              Fulfillment hold:{" "}
                              <strong>
                                {reviewCase.hold_order_fulfillment ? "Yes" : "No"}
                              </strong>
                            </p>
                          </div>

                          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                            <p className="font-bold text-gray-900">
                              Payout Scope
                            </p>
                            <p className="mt-2 text-gray-700">
                              Scoped rows: <strong>{payout.scopedRows.length}</strong>
                            </p>
                            <p className="mt-1 text-gray-700">
                              Held rows: <strong>{payout.heldRows.length}</strong>
                            </p>
                            <p className="mt-1 text-gray-700">
                              Payable total:{" "}
                              <strong>{money(payout.payableTotal)}</strong>
                            </p>
                          </div>
                        </div>

                        {reviewCase.outcome_summary ? (
                          <p className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                            <strong>Outcome:</strong> {reviewCase.outcome_summary}
                          </p>
                        ) : null}

                        {eventsError ? (
                          <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                            Case activity unavailable: {eventsError}
                          </div>
                        ) : recentEvents.length > 0 ? (
                          <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                            <p className="font-bold text-gray-900">
                              Recent Activity
                            </p>
                            <div className="mt-3 space-y-3">
                              {recentEvents.slice(0, 3).map((event) => (
                                <div
                                  key={event.id}
                                  className="rounded border border-gray-200 bg-white p-3"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <p className="font-bold text-gray-900">
                                      {label(event.event_type)}
                                    </p>
                                    <p className="text-xs font-semibold text-gray-500">
                                      {dateLabel(event.created_at)}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-xs font-semibold text-gray-500">
                                    {label(event.previous_status)} {" -> "}{" "}
                                    {label(event.new_status)} / IP{" "}
                                    {event.ip_address || "not recorded"} /{" "}
                                    {label(event.identity_risk)}
                                  </p>
                                  <p className="mt-2 text-gray-700">
                                    {event.note || "No event note."}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <a
                          href={`/api/admin/order-review-cases/${reviewCase.id}/packet`}
                          className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm font-bold text-white"
                        >
                          Download Case Packet PDF
                        </a>
                      </div>

                      <aside className="rounded border border-gray-200 bg-gray-50 p-4">
                        <h4 className="mb-3 text-sm font-bold uppercase text-gray-500">
                          Case Controls
                        </h4>
                        <CaseQueueActions
                          key={`${reviewCase.id}-${reviewCase.status}-${reviewCase.updated_at || ""}`}
                          caseId={reviewCase.id}
                          status={reviewCase.status}
                          outcomeSummary={reviewCase.outcome_summary}
                          heldRowCount={payout.heldRows.length}
                          payoutRowCount={payout.scopedRows.length}
                          payableTotal={payout.payableTotal}
                        />
                      </aside>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <form onSubmit={createCase} className="mt-6 rounded border p-4">
            <h3 className="text-lg font-bold">Open New Case</h3>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm font-semibold">
                Case Type
                <select
                  value={caseType}
                  onChange={(event) => setCaseType(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {caseTypeOptions.map(([value, optionLabel]) => (
                    <option key={value} value={value}>
                      {optionLabel}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold">
                Severity
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {severityOptions.map(([value, optionLabel]) => (
                    <option key={value} value={value}>
                      {optionLabel}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold">
                Seller Scope
                <select
                  value={sellerAccountId}
                  onChange={(event) => setSellerAccountId(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="all">All seller-owned rows</option>
                  {sellerOptions.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {seller.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold">
              Notes
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="What happened, what evidence is needed, and what should be held."
              />
            </label>

            <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <label className="flex items-start gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={holdSellerPayouts}
                  onChange={(event) => setHoldSellerPayouts(event.target.checked)}
                  className="mt-1"
                />
                Hold related seller payout ledger rows
              </label>

              <label className="flex items-start gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={holdOrderFulfillment}
                  onChange={(event) =>
                    setHoldOrderFulfillment(event.target.checked)
                  }
                  className="mt-1"
                />
                Move unshipped order into shipping review
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-black px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                {busy ? "Opening..." : "Open Case"}
              </button>
              {message ? <p className="text-sm font-semibold">{message}</p> : null}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
