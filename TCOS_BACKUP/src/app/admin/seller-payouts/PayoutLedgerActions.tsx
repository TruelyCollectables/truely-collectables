"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type LedgerStatus =
  | "hold_pending_fulfillment"
  | "hold_dispute_or_review"
  | "eligible"
  | "reversed"
  | "cancelled";

export default function PayoutLedgerActions({
  ledgerEntryId,
  status,
  releaseBlocked,
  releaseBlockReason,
}: {
  ledgerEntryId: string;
  status: string | null;
  releaseBlocked?: boolean;
  releaseBlockReason?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [adminNote, setAdminNote] = useState("");

  async function updateStatus(nextStatus: LedgerStatus) {
    setLoading(nextStatus);

    try {
      const response = await fetch("/api/admin/seller-payouts/ledger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ledgerEntryId,
          status: nextStatus,
          adminNote,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Could not update seller payout ledger row.");
        return;
      }

      setAdminNote("");
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Could not update seller payout ledger row.");
    } finally {
      setLoading("");
    }
  }

  const currentStatus = status || "hold_pending_fulfillment";
  const finalStatus =
    currentStatus === "paid" ||
    currentStatus === "reversed" ||
    currentStatus === "cancelled";
  const locked = loading !== "" || finalStatus;

  return (
    <div className="grid gap-2">
      <input
        value={adminNote}
        onChange={(event) => setAdminNote(event.target.value)}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
        placeholder="Release/hold note"
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={locked || currentStatus === "eligible" || releaseBlocked}
          onClick={() => updateStatus("eligible")}
          className="rounded bg-emerald-700 px-2 py-1 text-xs font-bold text-white disabled:bg-neutral-400"
        >
          {loading === "eligible" ? "Saving..." : "Release"}
        </button>
        <button
          type="button"
          disabled={locked || currentStatus === "hold_dispute_or_review"}
          onClick={() => updateStatus("hold_dispute_or_review")}
          className="rounded bg-amber-700 px-2 py-1 text-xs font-bold text-white disabled:bg-neutral-400"
        >
          {loading === "hold_dispute_or_review" ? "Saving..." : "Review Hold"}
        </button>
        <button
          type="button"
          disabled={locked || currentStatus === "hold_pending_fulfillment"}
          onClick={() => updateStatus("hold_pending_fulfillment")}
          className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold disabled:text-neutral-400"
        >
          {loading === "hold_pending_fulfillment" ? "Saving..." : "Fulfill Hold"}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => updateStatus("reversed")}
          className="rounded border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700 disabled:text-neutral-400"
        >
          {loading === "reversed" ? "Saving..." : "Reverse"}
        </button>
      </div>

      {releaseBlocked ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          {releaseBlockReason ||
            "Order must clear fulfillment and review before payout release."}
        </p>
      ) : null}

      <button
        type="button"
        disabled={locked}
        onClick={() => updateStatus("cancelled")}
        className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold disabled:text-neutral-400"
      >
        {loading === "cancelled" ? "Saving..." : "Cancel Row"}
      </button>
    </div>
  );
}
