"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReconciliationActions({
  itemId,
}: {
  itemId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function runNow() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reconciliation failed");
      router.refresh();
    } catch (error: any) {
      alert(error.message || "Reconciliation failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(status: "resolved" | "ignored") {
    const resolutionNote = window.prompt(
      status === "resolved"
        ? "How was this money difference resolved?"
        : "Why is this alert safe to ignore?",
    );
    if (!resolutionNote?.trim() || !itemId) return;

    setBusy(true);
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status, resolutionNote }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update alert");
      router.refresh();
    } catch (error: any) {
      alert(error.message || "Could not update alert");
    } finally {
      setBusy(false);
    }
  }

  if (!itemId) {
    return (
      <button
        type="button"
        onClick={runNow}
        disabled={busy}
        className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
      >
        {busy ? "Reconciling..." : "Run Previous UTC Day"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => resolve("resolved")}
        disabled={busy}
        className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
      >
        Resolve
      </button>
      <button
        type="button"
        onClick={() => resolve("ignored")}
        disabled={busy}
        className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black disabled:opacity-50"
      >
        Ignore With Note
      </button>
    </div>
  );
}
