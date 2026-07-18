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
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function runNow() {
    setBusy(true);
    setMessage({ tone: "info", text: "Running reconciliation..." });
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Reconciliation failed");
      setMessage({ tone: "success", text: "Reconciliation completed." });
      router.refresh();
    } catch (error: any) {
      setMessage({ tone: "error", text: error.message || "Reconciliation failed" });
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
    setMessage({ tone: "info", text: "Saving reconciliation alert update..." });
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status, resolutionNote }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update alert");
      setMessage({
        tone: "success",
        text: status === "resolved" ? "Alert marked resolved." : "Alert ignored with note.",
      });
      router.refresh();
    } catch (error: any) {
      setMessage({ tone: "error", text: error.message || "Could not update alert" });
    } finally {
      setBusy(false);
    }
  }

  if (!itemId) {
    return (
      <div className="grid gap-2">
        <button
          type="button"
          onClick={runNow}
          disabled={busy}
          className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? "Reconciling..." : "Run Previous UTC Day"}
        </button>
        {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
      </div>
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
      {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p className={`w-full rounded border px-2 py-1 text-xs font-bold ${className}`}>
      {children}
    </p>
  );
}
