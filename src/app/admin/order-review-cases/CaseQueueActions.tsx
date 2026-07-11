"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

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

const resolutionActionOptions = [
  [
    "release_to_seller",
    "Release to seller",
    "Move related held rows to eligible after a seller-favorable decision.",
  ],
  [
    "reverse_for_buyer",
    "Reverse for buyer",
    "Reverse related held rows after a buyer-favorable decision.",
  ],
  [
    "cancel_no_payout",
    "Cancel seller payout",
    "Cancel related held rows with no seller payout.",
  ],
  [
    "hold_for_appeal",
    "Keep held",
    "Leave related rows on dispute/review hold for appeal or continued review.",
  ],
] as const;

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function defaultResolutionAction(status: string | null | undefined) {
  if (status === "decided_for_seller") return "release_to_seller";
  if (status === "decided_for_buyer") return "reverse_for_buyer";
  return "hold_for_appeal";
}

function resolutionOptionsForStatus(status: string | null | undefined) {
  if (status === "decided_for_seller") {
    return resolutionActionOptions.filter(
      ([value]) => value === "release_to_seller" || value === "hold_for_appeal",
    );
  }

  if (status === "decided_for_buyer") {
    return resolutionActionOptions.filter(
      ([value]) =>
        value === "reverse_for_buyer" ||
        value === "cancel_no_payout" ||
        value === "hold_for_appeal",
    );
  }

  if (status === "closed") {
    return resolutionActionOptions;
  }

  return resolutionActionOptions.filter(
    ([value]) => value === "hold_for_appeal",
  );
}

function payoutResolutionSkipLabel(reason: string | null | undefined) {
  if (reason === "order_has_dry_run_shipping_only") {
    return "dry-run shipping only";
  }

  if (reason === "order_not_shipped") return "order not shipped";
  if (reason === "order_still_in_review") return "order still in review";
  if (reason === "order_not_verified") return "order not verified";
  if (reason === "already_target_status") return "already target status";
  if (reason === "active_or_paid_cash_out_request") {
    return "active or paid cash-out request";
  }
  if (reason?.startsWith("terminal_")) {
    return `terminal ${reason.replace("terminal_", "").replaceAll("_", " ")}`;
  }

  return reason?.replaceAll("_", " ") || "skipped";
}

export default function CaseQueueActions({
  caseId,
  status,
  outcomeSummary,
  heldRowCount,
  payoutRowCount,
  payableTotal,
}: {
  caseId: string;
  status: string | null;
  outcomeSummary: string | null;
  heldRowCount: number;
  payoutRowCount: number;
  payableTotal: number;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status || "open");
  const [adminNote, setAdminNote] = useState("");
  const [nextOutcomeSummary, setNextOutcomeSummary] = useState(
    outcomeSummary || "",
  );
  const [resolutionAction, setResolutionAction] = useState(
    defaultResolutionAction(status),
  );
  const [resolutionNote, setResolutionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resolutionMessage, setResolutionMessage] = useState("");
  const availableResolutionOptions = resolutionOptionsForStatus(status);
  const selectedResolutionOption =
    availableResolutionOptions.find(([value]) => value === resolutionAction) ||
    availableResolutionOptions[0];

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
          caseId,
          status: nextStatus,
          adminNote,
          outcomeSummary: nextOutcomeSummary,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not update order review case.");
      }

      setMessage("Saved.");
      setAdminNote("");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Could not update order review case.");
    } finally {
      setBusy(false);
    }
  }

  async function resolvePayouts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResolutionBusy(true);
    setResolutionMessage("");

    try {
      const response = await fetch(
        `/api/admin/order-review-cases/${caseId}/payout-resolution`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: resolutionAction,
            adminNote: resolutionNote,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not resolve case payout rows.");
      }

      const skippedReasons = Array.isArray(data.skipped)
        ? Array.from(
            new Set(
              data.skipped.map((row: { reason?: string | null }) =>
                payoutResolutionSkipLabel(row.reason),
              ),
            ),
          )
        : [];

      setResolutionMessage(
        `${data.changedCount || 0} row(s) updated, ${
          data.skippedCount || 0
        } skipped${
          skippedReasons.length > 0 ? `: ${skippedReasons.join(", ")}` : ""
        }.`,
      );
      setResolutionNote("");
      router.refresh();
    } catch (error: any) {
      setResolutionMessage(error.message || "Could not resolve case payout rows.");
    } finally {
      setResolutionBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={updateCase} className="space-y-3">
        <label className="block text-xs font-black uppercase text-neutral-500">
          Case Status
          <select
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-neutral-950"
          >
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-black uppercase text-neutral-500">
          Admin Note
          <input
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-neutral-950"
            placeholder="Short audit note"
          />
        </label>

        <label className="block text-xs font-black uppercase text-neutral-500">
          Outcome
          <textarea
            value={nextOutcomeSummary}
            onChange={(event) => setNextOutcomeSummary(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-neutral-950"
            placeholder="Decision, recovery, or current finding"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-neutral-950 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save Case"}
          </button>
          {message ? (
            <span className="text-xs font-bold text-neutral-600">{message}</span>
          ) : null}
        </div>
      </form>

      <form
        onSubmit={resolvePayouts}
        className="space-y-3 border-t border-neutral-200 pt-4"
      >
        <div className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <p className="font-black text-neutral-900">Payout Resolution</p>
          <p className="mt-1 text-neutral-600">
            Scoped rows: {payoutRowCount} / Held: {heldRowCount} / Payable:{" "}
            {money(payableTotal)}
          </p>
        </div>

        <label className="block text-xs font-black uppercase text-neutral-500">
          Resolution Action
          <select
            value={selectedResolutionOption?.[0] || resolutionAction}
            onChange={(event) => setResolutionAction(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-neutral-950"
            disabled={payoutRowCount === 0}
          >
            {availableResolutionOptions.map(([value, optionLabel]) => (
              <option key={value} value={value}>
                {optionLabel}
              </option>
            ))}
          </select>
        </label>

        <p className="text-xs font-semibold text-neutral-600">
          {selectedResolutionOption?.[2] ||
            "No payout resolution options are available."}
        </p>

        <label className="block text-xs font-black uppercase text-neutral-500">
          Payout Note
          <input
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-neutral-950"
            placeholder="Why these payout rows are being released, reversed, or kept held"
            disabled={payoutRowCount === 0}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={resolutionBusy || payoutRowCount === 0}
            className="rounded-md border border-neutral-900 px-3 py-2 text-sm font-black text-neutral-950 disabled:opacity-50"
          >
            {resolutionBusy ? "Applying..." : "Apply Payout Resolution"}
          </button>
          {resolutionMessage ? (
            <span className="text-xs font-bold text-neutral-600">
              {resolutionMessage}
            </span>
          ) : null}
        </div>

        {payoutRowCount === 0 ? (
          <p className="text-xs font-semibold text-neutral-600">
            No seller payout rows are tied to this case scope.
          </p>
        ) : null}
      </form>
    </div>
  );
}
