"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH,
  financialReconciliationDecisionError,
} from "../../../lib/admin-financial-reconciliation";

function reconciliationActionTitle({
  busy,
  blockedReason,
  ready,
}: {
  busy: boolean;
  blockedReason?: string | null;
  ready: string;
}) {
  if (busy) return "Finish the current reconciliation action first.";

  if (blockedReason) return blockedReason;

  return ready;
}

export default function ReconciliationActions({
  itemId,
}: {
  itemId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const reconciliationActionRunningRef = useRef(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"resolved" | "ignored" | null>(
    null,
  );
  const [resolutionNote, setResolutionNote] = useState("");
  const trimmedResolutionNote = resolutionNote.trim();
  const saveDecisionLabel =
    pendingStatus === "resolved"
      ? "Resolve Alert"
      : pendingStatus === "ignored"
        ? "Ignore Alert"
        : "Save decision";
  const savingDecisionLabel =
    pendingStatus === "resolved"
      ? "Resolving alert..."
      : pendingStatus === "ignored"
        ? "Ignoring alert..."
        : "Saving decision...";
  const canSaveDecision =
    !financialReconciliationDecisionError({
      itemId,
      status: pendingStatus,
      resolutionNote: trimmedResolutionNote,
    }) && Boolean(pendingStatus);
  const saveDecisionBlockedReason =
    financialReconciliationDecisionError({
      itemId,
      status: pendingStatus,
      resolutionNote: trimmedResolutionNote,
    }) || null;

  function reconciliationActionBlockedReason(action: string) {
    return reconciliationActionRunningRef.current || busy
      ? `Finish the current reconciliation action before ${action}.`
      : "";
  }

  function showReconciliationActionBlocked(action: string) {
    const blockedReason = reconciliationActionBlockedReason(action);

    if (!blockedReason) return false;

    setMessage({ tone: "error", text: blockedReason });
    return true;
  }

  async function runNow() {
    if (showReconciliationActionBlocked("running reconciliation again")) return;

    reconciliationActionRunningRef.current = true;
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
      reconciliationActionRunningRef.current = false;
      setBusy(false);
    }
  }

  async function resolve(status: "resolved" | "ignored") {
    if (showReconciliationActionBlocked("saving another reconciliation decision")) {
      return;
    }

    const decisionError = financialReconciliationDecisionError({
      itemId,
      status,
      resolutionNote: trimmedResolutionNote,
    });

    if (decisionError || !itemId) {
      setMessage({
        tone: "error",
        text: decisionError || "Reconciliation item is required.",
      });
      return;
    }

    reconciliationActionRunningRef.current = true;
    setBusy(true);
    setMessage({ tone: "info", text: "Saving reconciliation alert update..." });
    try {
      const response = await fetch("/api/admin/financial-reconciliation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status, resolutionNote: trimmedResolutionNote }),
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
      reconciliationActionRunningRef.current = false;
      setBusy(false);
    }
  }

  function beginDecision(status: "resolved" | "ignored") {
    if (showReconciliationActionBlocked("starting another alert decision")) return;

    setPendingStatus(status);
    setResolutionNote("");
    setMessage(null);
  }

  function cancelDecision() {
    if (showReconciliationActionBlocked("cancelling the current alert decision")) {
      return;
    }

    setPendingStatus(null);
    setResolutionNote("");
  }

  if (!itemId) {
    return (
      <div className="grid gap-2">
        <button
          type="button"
          onClick={runNow}
          aria-disabled={busy}
          aria-busy={busy}
          title={reconciliationActionTitle({
            busy,
            ready: "Run the previous UTC day financial reconciliation.",
          })}
          className={`rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-neutral-950 shadow-sm transition ${
            busy ? "cursor-not-allowed opacity-50" : "hover:bg-emerald-300"
          }`}
        >
          {busy ? "Reconciling..." : "Run Previous UTC Day"}
        </button>
        {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
      </div>
    );
  }

  return (
    <div className="grid min-w-[280px] gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => beginDecision("resolved")}
          aria-disabled={busy}
          aria-pressed={pendingStatus === "resolved"}
          title={reconciliationActionTitle({
            busy,
            ready: "Open the resolution note panel for this money alert.",
          })}
          className={`rounded-full bg-emerald-700 px-3 py-2 text-xs font-black text-white shadow-sm ${
            busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          Resolve
        </button>
        <button
          type="button"
          onClick={() => beginDecision("ignored")}
          aria-disabled={busy}
          aria-pressed={pendingStatus === "ignored"}
          title={reconciliationActionTitle({
            busy,
            ready: "Open the ignore-with-note panel for this money alert.",
          })}
          className={`rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-900 shadow-sm ${
            busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          Ignore With Note
        </button>
      </div>
      {pendingStatus ? (
        <div className="rounded-2xl border border-neutral-200 bg-white/80 p-3 shadow-sm">
          <label className="block text-xs font-black text-neutral-800">
            {pendingStatus === "resolved"
              ? "How was this money difference resolved?"
              : "Why is this alert safe to ignore?"}
            <textarea
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-950 shadow-inner outline-none focus:border-neutral-900"
              placeholder="Add the audit note that explains this decision."
            />
          </label>
          <p className="mt-1 text-xs font-semibold text-neutral-600">
            Minimum {FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH} characters. This note becomes the audit trail for the decision.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolve(pendingStatus)}
              aria-disabled={busy || !canSaveDecision}
              aria-busy={busy}
              title={reconciliationActionTitle({
                blockedReason: saveDecisionBlockedReason,
                busy,
                ready:
                  pendingStatus === "resolved"
                    ? "Save this money alert as resolved with the audit note."
                    : "Save this money alert as ignored with the audit note.",
              })}
              className={`rounded-full bg-neutral-950 px-3 py-2 text-xs font-black text-white shadow-sm ${
                busy || !canSaveDecision ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              {busy ? savingDecisionLabel : saveDecisionLabel}
            </button>
            <button
              type="button"
              onClick={cancelDecision}
              aria-disabled={busy}
              title={reconciliationActionTitle({
                busy,
                ready: "Close this reconciliation decision panel without saving.",
              })}
              className={`rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-black shadow-sm ${
                busy ? "cursor-not-allowed opacity-50" : ""
              }`}
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
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`w-full rounded-2xl border px-3 py-2 text-xs font-bold ${className}`}
    >
      {children}
    </p>
  );
}
