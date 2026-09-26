"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

export default function PendingReceiptActions({
  acquisitionItemId,
  status,
  hasScan,
  onChanged,
}: {
  acquisitionItemId: number;
  status: string;
  hasScan: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (status === "received_unscanned") {
    return (
      <Link
        href="/kingmaker"
        className="mt-2 inline-flex rounded-lg border border-emerald-500 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-950"
      >
        Add front + back photos
      </Link>
    );
  }

  if (hasScan) return null;

  async function receiveWithoutPhotos() {
    setBusy(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-purchase-receive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ acquisitionItemId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || data.status !== "received_unscanned") {
        throw new Error(data.error || data.detail || "Could not receive this purchase.");
      }
      if (onChanged) await onChanged();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void receiveWithoutPhotos()}
        className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
      >
        {busy ? "Receiving…" : "Receive now — no photos"}
      </button>
      {error ? <p className="mt-1 max-w-xs text-xs font-bold text-rose-300">{error}</p> : null}
    </div>
  );
}
