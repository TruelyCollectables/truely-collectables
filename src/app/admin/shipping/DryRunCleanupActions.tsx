"use client";

import { useState } from "react";

export default function DryRunCleanupActions({
  orderId,
}: {
  orderId: number;
}) {
  const [retiring, setRetiring] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  async function retireProof() {
    if (
      !window.confirm(
        "Retire TCOS dry-run shipping proof for this order? This clears simulated tracking, voids simulated label records, and marks simulated events retired. It does not buy or void real postage.",
      )
    ) {
      return;
    }

    setRetiring(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/shipping/dry-run-cleanup", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "retire_order_dry_run_proof",
          orderId,
          note,
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
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error: any) {
      setMessage(error.message || "Could not retire dry-run shipping proof.");
    } finally {
      setRetiring(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional cleanup note: why this simulated proof is being retired."
        rows={2}
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <button
        onClick={retireProof}
        disabled={retiring}
        className="rounded bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {retiring ? "Retiring..." : "Retire Dry-Run Proof"}
      </button>
      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold text-red-950">
          {message}
        </p>
      ) : null}
    </div>
  );
}
