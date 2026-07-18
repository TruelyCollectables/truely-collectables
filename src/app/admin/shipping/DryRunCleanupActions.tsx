"use client";

import { useState } from "react";

function noticeTone(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("could not") ||
    normalized.includes("failed") ||
    normalized.includes("add a cleanup note") ||
    normalized.includes("required")
  ) {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (normalized.includes("retiring")) {
    return "border-blue-200 bg-blue-50 text-blue-950";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

export default function DryRunCleanupActions({
  orderId,
}: {
  orderId: number;
}) {
  const [retiring, setRetiring] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "record-real-label" | "retire-only" | null
  >(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const cleanupNoteReady = note.trim().length >= 8;
  const confirmDisabled = retiring || !acknowledged || !cleanupNoteReady;

  async function retireProof({ redirectToManual }: { redirectToManual: boolean }) {
    if (!cleanupNoteReady) {
      setMessage("Add a cleanup note before retiring dry-run shipping proof.");
      return;
    }

    setRetiring(true);
    setMessage("Retiring dry-run shipping proof...");

    try {
      const response = await fetch("/api/admin/shipping/dry-run-cleanup", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "retire_order_dry_run_proof",
          orderId,
          note: note.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not retire dry-run shipping proof.");
        return;
      }

      setMessage(
        data.message ||
          "Dry-run proof retired. Record real carrier/Coverage proof next.",
      );
      setPendingAction(null);
      setAcknowledged(false);
      setTimeout(() => {
        if (redirectToManual) {
          window.location.href = `/admin/orders/${orderId}?shippingAction=manualPurchase`;
        } else {
          window.location.reload();
        }
      }, 800);
    } catch (error: any) {
      setMessage(error.message || "Could not retire dry-run shipping proof.");
    } finally {
      setRetiring(false);
    }
  }

  function requestRetire(action: "record-real-label" | "retire-only") {
    setPendingAction(action);
    setAcknowledged(false);
    setMessage("");
  }

  const pendingRedirect = pendingAction === "record-real-label";

  return (
    <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red-700">
          Dry-run cleanup
        </p>
        <p className="mt-1 text-sm font-semibold leading-6 text-red-950">
          Retiring proof clears simulated tracking, voids simulated label
          records, and marks simulated events retired. It does not buy or void
          real postage.
        </p>
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Required cleanup note: why this simulated proof is being retired."
        rows={2}
        className="w-full rounded-2xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-950 outline-none placeholder:text-red-300 focus:border-red-500"
      />
      {!cleanupNoteReady ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950">
          Required: cleanup note with at least 8 characters.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => requestRetire("record-real-label")}
          disabled={retiring}
          className="rounded-2xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Retire + Record Real Label
        </button>
        <button
          type="button"
          onClick={() => requestRetire("retire-only")}
          disabled={retiring}
          className="rounded-2xl border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-950 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Retire Only
        </button>
      </div>

      {pendingAction ? (
        <div className="rounded-2xl border border-red-300 bg-white p-3">
          <p className="text-sm font-black text-red-950">
            Confirm dry-run proof retirement for order #{orderId}
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-red-800">
            This cleanup is permanent for the simulated proof. Choose cancel if
            you still need the dry-run label/tracking records visible.
          </p>
          <label className="mt-3 flex items-start gap-2 text-xs font-bold text-red-950">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5"
            />
            I understand this retires simulated proof only and does not touch
            real postage.
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => retireProof({ redirectToManual: pendingRedirect })}
              className="rounded-2xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retiring
                ? "Retiring..."
                : pendingRedirect
                  ? "Confirm + Record Real Label"
                  : "Confirm Retire Only"}
            </button>
            <button
              type="button"
              disabled={retiring}
              onClick={() => {
                setPendingAction(null);
                setAcknowledged(false);
              }}
              className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`rounded-2xl border px-3 py-2 text-xs font-black ${noticeTone(message)}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
