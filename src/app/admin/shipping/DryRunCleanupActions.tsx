"use client";

import { useState } from "react";

function noticeTone(message: string) {
  const normalized = message.toLowerCase();
  if (isBlockingNotice(message)) {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (normalized.includes("retiring")) {
    return "border-blue-200 bg-blue-50 text-blue-950";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

function isBlockingNotice(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not") ||
    normalized.includes("failed") ||
    normalized.includes("finish the current") ||
    normalized.includes("add a cleanup note") ||
    normalized.includes("confirm the dry-run cleanup acknowledgement") ||
    normalized.includes("required")
  );
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

  function explainDryRunCleanupBlock(action: string) {
    if (retiring) {
      setMessage("Finish the current dry-run cleanup action first.");
      return true;
    }

    if (!cleanupNoteReady) {
      setMessage(`Add a cleanup note before ${action}.`);
      return true;
    }

    return false;
  }

  async function retireProof({ redirectToManual }: { redirectToManual: boolean }) {
    if (explainDryRunCleanupBlock("retiring dry-run shipping proof")) {
      return;
    }

    if (!acknowledged) {
      setMessage(
        "Confirm the dry-run cleanup acknowledgement before retiring proof.",
      );
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
    if (
      explainDryRunCleanupBlock(
        action === "record-real-label"
          ? "opening the real label handoff"
          : "opening dry-run retire confirmation",
      )
    ) {
      return;
    }

    setPendingAction(action);
    setAcknowledged(false);
    setMessage("");
  }

  function cancelRetire() {
    if (retiring) {
      setMessage("Finish the current dry-run cleanup action before canceling.");
      return;
    }

    setPendingAction(null);
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
          aria-disabled={retiring || !cleanupNoteReady}
          className="rounded-2xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          Retire + Record Real Label
        </button>
        <button
          type="button"
          onClick={() => requestRetire("retire-only")}
          aria-disabled={retiring || !cleanupNoteReady}
          className="rounded-2xl border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-950 hover:bg-red-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
              onClick={() => retireProof({ redirectToManual: pendingRedirect })}
              aria-disabled={confirmDisabled}
              aria-busy={retiring}
              className="rounded-2xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {retiring
                ? pendingRedirect
                  ? "Retiring + opening real label form..."
                  : "Retiring simulated proof..."
                : pendingRedirect
                  ? "Confirm + Record Real Label"
                  : "Confirm Retire Only"}
            </button>
            <button
              type="button"
              aria-disabled={retiring}
              onClick={cancelRetire}
              className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950 hover:bg-neutral-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p
          role={isBlockingNotice(message) ? "alert" : "status"}
          aria-live={
            message.toLowerCase().includes("retiring") ? "polite" : "assertive"
          }
          className={`rounded-2xl border px-3 py-2 text-xs font-black ${noticeTone(message)}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
