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
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  function actionRequirements(nextStatus: LedgerStatus) {
    const missing = [];

    if (
      (nextStatus === "hold_dispute_or_review" ||
        nextStatus === "reversed" ||
        nextStatus === "cancelled") &&
      adminNote.trim().length < 8
    ) {
      missing.push("audit note");
    }

    if (nextStatus === "eligible" && releaseBlocked) {
      missing.push("release blocker resolution");
    }

    return missing;
  }

  async function updateStatus(nextStatus: LedgerStatus) {
    const missing = actionRequirements(nextStatus);
    if (missing.length > 0) {
      setMessage({
        tone: "error",
        text: `Payout ledger update needs: ${missing.join(", ")}.`,
      });
      return;
    }

    setLoading(nextStatus);
    setMessage({ tone: "info", text: "Saving payout ledger status..." });

    try {
      const response = await fetch("/api/admin/seller-payouts/ledger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ledgerEntryId,
          status: nextStatus,
          adminNote: adminNote.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Could not update seller payout ledger row.",
        });
        return;
      }

      setAdminNote("");
      setMessage({
        tone: "success",
        text: `Payout ledger row moved to ${nextStatus.replaceAll("_", " ")}.`,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({
        tone: "error",
        text: "Could not update seller payout ledger row.",
      });
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
  const visibleRequirements = Array.from(
    new Set(
      ([
        "eligible",
        "hold_dispute_or_review",
        "reversed",
        "cancelled",
      ] as LedgerStatus[]).flatMap((nextStatus) => actionRequirements(nextStatus)),
    ),
  );
  const actionLabel = (nextStatus: LedgerStatus) =>
    loading === nextStatus
      ? `Moving to ${nextStatus.replaceAll("_", " ")}...`
      : null;

  return (
    <div className="grid gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <input
        value={adminNote}
        onChange={(event) => setAdminNote(event.target.value)}
        className="w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
        placeholder="Release/hold/reversal audit note"
      />

      {visibleRequirements.length > 0 ? (
        <ActionNotice tone="info">
          Some ledger actions require: {visibleRequirements.join(", ")}.
        </ActionNotice>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => updateStatus("eligible")}
          aria-busy={loading === "eligible"}
          disabled={
            locked ||
            currentStatus === "eligible" ||
            actionRequirements("eligible").length > 0
          }
          className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {actionLabel("eligible") || "Release"}
        </button>
        <button
          type="button"
          onClick={() => updateStatus("hold_dispute_or_review")}
          aria-busy={loading === "hold_dispute_or_review"}
          disabled={
            locked ||
            currentStatus === "hold_dispute_or_review" ||
            actionRequirements("hold_dispute_or_review").length > 0
          }
          className="rounded-2xl bg-amber-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {actionLabel("hold_dispute_or_review") || "Review Hold"}
        </button>
        <button
          type="button"
          disabled={locked || currentStatus === "hold_pending_fulfillment"}
          onClick={() => updateStatus("hold_pending_fulfillment")}
          aria-busy={loading === "hold_pending_fulfillment"}
          className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          {actionLabel("hold_pending_fulfillment") || "Fulfill Hold"}
        </button>
        <button
          type="button"
          onClick={() => updateStatus("reversed")}
          aria-busy={loading === "reversed"}
          disabled={locked || actionRequirements("reversed").length > 0}
          className="rounded-2xl border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          {actionLabel("reversed") || "Reverse"}
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
        onClick={() => updateStatus("cancelled")}
        aria-busy={loading === "cancelled"}
        disabled={locked || actionRequirements("cancelled").length > 0}
        className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:text-neutral-400"
      >
        {actionLabel("cancelled") || "Cancel Row"}
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
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-2xl border px-3 py-2 text-xs font-black ${className}`}
    >
      {children}
    </p>
  );
}
