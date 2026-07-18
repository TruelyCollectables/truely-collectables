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
  const [pendingStatus, setPendingStatus] = useState<"resolved" | "ignored" | null>(
    null,
  );
  const [resolutionNote, setResolutionNote] = useState("");

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
    if (!resolutionNote.trim() || !itemId) {
      setMessage({
        tone: "error",
        text:
          status === "resolved"
            ? "Add a note explaining how this money difference was resolved."
            : "Add a note explaining why this alert is safe to ignore.",
      });
      return;
    }

    setBusy(true);
    setMessage({ tone: "info", text: "Saving reconciliation alert update..." });
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status, resolutionNote: resolutionNote.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update alert");
      setMessage({
        tone: "success",
        text: status === "resolved" ? "Alert marked resolved." : "Alert ignored with note.",
      });
      setPendingStatus(null);
      setResolutionNote("");
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
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          setPendingStatus("resolved");
          setResolutionNote("");
          setMessage(null);
        }}
        disabled={busy}
        className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
      >
        Resolve
      </button>
      <button
        type="button"
        onClick={() => {
          setPendingStatus("ignored");
          setResolutionNote("");
          setMessage(null);
        }}
        disabled={busy}
        className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black disabled:opacity-50"
      >
        Ignore With Note
      </button>
      </div>
      {pendingStatus ? (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
          <label className="block text-xs font-black text-neutral-800">
            {pendingStatus === "resolved"
              ? "How was this money difference resolved?"
              : "Why is this alert safe to ignore?"}
            <textarea
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Add the audit note that explains this decision."
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolve(pendingStatus)}
              disabled={busy}
              className="rounded bg-neutral-950 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save decision"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingStatus(null);
                setResolutionNote("");
              }}
              disabled={busy}
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-black disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
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
