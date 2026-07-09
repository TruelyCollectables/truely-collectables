"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PayoutStatus =
  | "requested"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "cancelled";

export default function PayoutRequestActions({
  requestId,
  status,
  reviewBlocked,
  reviewGuardUnavailable,
  reviewBlockReason,
}: {
  requestId: string;
  status: string | null;
  reviewBlocked?: boolean;
  reviewGuardUnavailable?: boolean;
  reviewBlockReason?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [providerPayoutReference, setProviderPayoutReference] = useState("");
  const [finalProcessorFeeAmount, setFinalProcessorFeeAmount] = useState("");

  async function updateStatus(nextStatus: PayoutStatus) {
    setLoading(nextStatus);

    try {
      const response = await fetch("/api/admin/seller-payouts/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          status: nextStatus,
          adminNote,
          providerPayoutReference,
          finalProcessorFeeAmount,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Could not update payout request.");
        return;
      }

      setAdminNote("");
      setProviderPayoutReference("");
      setFinalProcessorFeeAmount("");
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Could not update payout request.");
    } finally {
      setLoading("");
    }
  }

  const currentStatus = status || "requested";
  const locked = currentStatus === "paid" || loading !== "";
  const payoutAdvanceBlocked = Boolean(reviewBlocked || reviewGuardUnavailable);

  return (
    <div className="grid gap-2">
      <input
        value={adminNote}
        onChange={(event) => setAdminNote(event.target.value)}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
        placeholder="Admin note"
      />

      {currentStatus === "processing" ? (
        <div className="grid gap-2 rounded border border-neutral-200 bg-neutral-50 p-2">
          <input
            value={providerPayoutReference}
            onChange={(event) =>
              setProviderPayoutReference(event.target.value)
            }
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
            placeholder="Provider payout reference"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={finalProcessorFeeAmount}
            onChange={(event) =>
              setFinalProcessorFeeAmount(event.target.value)
            }
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
            placeholder="Final processor fee"
          />
        </div>
      ) : null}

      {reviewGuardUnavailable ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          Review guard unavailable. Case checks must load before this request can
          be approved or paid.
        </p>
      ) : reviewBlocked ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          {reviewBlockReason ||
            "This request is blocked by an active case or held payout rows."}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={
            locked ||
            currentStatus !== "requested" ||
            payoutAdvanceBlocked
          }
          onClick={() => updateStatus("approved")}
          className="rounded bg-emerald-700 px-2 py-1 text-xs font-bold text-white disabled:bg-neutral-400"
        >
          {loading === "approved" ? "Saving..." : "Approve"}
        </button>
        <button
          type="button"
          disabled={
            locked || currentStatus !== "approved" || payoutAdvanceBlocked
          }
          onClick={() => updateStatus("processing")}
          className="rounded bg-neutral-950 px-2 py-1 text-xs font-bold text-white disabled:bg-neutral-400"
        >
          {loading === "processing" ? "Saving..." : "Processing"}
        </button>
        <button
          type="button"
          disabled={
            locked ||
            currentStatus !== "processing" ||
            providerPayoutReference.trim().length === 0 ||
            payoutAdvanceBlocked
          }
          onClick={() => updateStatus("paid")}
          className="rounded bg-emerald-950 px-2 py-1 text-xs font-bold text-white disabled:bg-neutral-400"
        >
          {loading === "paid" ? "Saving..." : "Mark Paid"}
        </button>
        <button
          type="button"
          disabled={locked || currentStatus === "rejected"}
          onClick={() => updateStatus("rejected")}
          className="rounded border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700 disabled:text-neutral-400"
        >
          {loading === "rejected" ? "Saving..." : "Reject"}
        </button>
      </div>

      <button
        type="button"
        disabled={locked || currentStatus === "cancelled"}
        onClick={() => updateStatus("cancelled")}
        className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold disabled:text-neutral-400"
      >
        {loading === "cancelled" ? "Saving..." : "Cancel Request"}
      </button>
    </div>
  );
}
