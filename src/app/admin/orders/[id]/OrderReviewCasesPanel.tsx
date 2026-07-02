"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

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

const statusOptions = [
  ["open", "Open"],
  ["evidence_gathering", "Evidence Gathering"],
  ["waiting_on_buyer", "Waiting On Buyer"],
  ["waiting_on_seller", "Waiting On Seller"],
  ["under_review", "Under Review"],
  ["decided_for_buyer", "Decided For Buyer"],
  ["decided_for_seller", "Decided For Seller"],
  ["appealed", "Appealed"],
  ["closed", "Closed"],
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

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

export default function OrderReviewCasesPanel({
  orderId,
  cases,
  sellerOptions,
  tableError,
}: {
  orderId: number;
  cases: AdminOrderReviewCase[];
  sellerOptions: SellerCaseOption[];
  tableError?: string | null;
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
              {cases.map((reviewCase) => (
                <div key={reviewCase.id} className="rounded border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase text-gray-500">
                        {label(reviewCase.case_type)} /{" "}
                        {label(reviewCase.severity)}
                      </p>
                      <h3 className="mt-1 text-lg font-bold">
                        {reviewCase.title}
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        {reviewCase.description || "No description saved."}
                      </p>
                    </div>
                    <span className="rounded border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold">
                      {label(reviewCase.status)}
                    </span>
                  </div>

                  <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                    <div>
                      <dt className="font-semibold text-gray-500">Seller Scope</dt>
                      <dd className="break-all">
                        {reviewCase.seller_account_id || "All seller items"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Opened</dt>
                      <dd>{dateLabel(reviewCase.opened_at)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-gray-500">Closed</dt>
                      <dd>{dateLabel(reviewCase.closed_at)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                    <p>
                      Seller payout hold:{" "}
                      <strong>
                        {reviewCase.hold_seller_payouts ? "Yes" : "No"}
                      </strong>
                    </p>
                    <p>
                      Fulfillment hold:{" "}
                      <strong>
                        {reviewCase.hold_order_fulfillment ? "Yes" : "No"}
                      </strong>
                    </p>
                  </div>

                  {reviewCase.outcome_summary ? (
                    <p className="mt-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                      <strong>Outcome:</strong> {reviewCase.outcome_summary}
                    </p>
                  ) : null}

                  <CaseStatusForm reviewCase={reviewCase} />
                </div>
              ))}
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

function CaseStatusForm({
  reviewCase,
}: {
  reviewCase: AdminOrderReviewCase;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(reviewCase.status);
  const [adminNote, setAdminNote] = useState("");
  const [outcomeSummary, setOutcomeSummary] = useState(
    reviewCase.outcome_summary || "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/order-review-cases", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseId: reviewCase.id,
          status,
          adminNote,
          outcomeSummary,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not update order review case.");
      }

      setMessage("Case updated.");
      setAdminNote("");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Could not update order review case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={updateCase} className="mt-4 border-t pt-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          >
            {statusOptions.map(([value, optionLabel]) => (
              <option key={value} value={value}>
                {optionLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold md:col-span-2">
          Admin Note
          <input
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="Short internal update for the audit log."
          />
        </label>
      </div>

      <label className="mt-3 block text-sm font-semibold">
        Outcome Summary
        <textarea
          value={outcomeSummary}
          onChange={(event) => setOutcomeSummary(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded border px-3 py-2"
          placeholder="Final decision or current finding."
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded border px-4 py-2 font-bold disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save Case Update"}
        </button>
        {message ? <p className="text-sm font-semibold">{message}</p> : null}
      </div>
    </form>
  );
}
