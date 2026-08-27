"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
  const ledgerActionRunningRef = useRef(false);
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

    ledgerActionRunningRef.current = true;
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
      ledgerActionRunningRef.current = false;
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
  function ledgerActionBlockedReason(nextStatus: LedgerStatus) {
    if (ledgerActionRunningRef.current || loading !== "") {
      return "Finish the current payout ledger action before starting another one.";
    }

    if (finalStatus) {
      return `Payout ledger row is already ${currentStatus}; final rows cannot be changed here.`;
    }

    if (nextStatus === "eligible" && currentStatus === "eligible") {
      return "This payout ledger row is already eligible.";
    }

    if (
      nextStatus === "hold_dispute_or_review" &&
      currentStatus === "hold_dispute_or_review"
    ) {
      return "This payout ledger row is already on review hold.";
    }

    if (
      nextStatus === "hold_pending_fulfillment" &&
      currentStatus === "hold_pending_fulfillment"
    ) {
      return "This payout ledger row is already held for fulfillment.";
    }

    const missing = actionRequirements(nextStatus);

    if (missing.length > 0) {
      return `Payout ledger update needs: ${missing.join(", ")}.`;
    }

    return "";
  }

  function ledgerActionReadyTitle(nextStatus: LedgerStatus) {
    switch (nextStatus) {
      case "eligible":
        return "Release this payout ledger row after fulfillment and review checks pass.";
      case "hold_dispute_or_review":
        return "Move this payout ledger row onto review hold with an audit note.";
      case "hold_pending_fulfillment":
        return "Hold this payout ledger row until fulfillment clears.";
      case "reversed":
        return "Reverse this payout ledger row with an audit note.";
      case "cancelled":
        return "Cancel this payout ledger row with an audit note.";
      default:
        return "Update this payout ledger row status.";
    }
  }

  function ledgerActionTitle(nextStatus: LedgerStatus) {
    if (loading !== "") {
      return "Finish the current payout ledger action before starting another one.";
    }

    if (finalStatus) {
      return `Payout ledger row is already ${currentStatus}; final rows cannot be changed here.`;
    }

    if (nextStatus === "eligible" && currentStatus === "eligible") {
      return "This payout ledger row is already eligible.";
    }

    if (
      nextStatus === "hold_dispute_or_review" &&
      currentStatus === "hold_dispute_or_review"
    ) {
      return "This payout ledger row is already on review hold.";
    }

    if (
      nextStatus === "hold_pending_fulfillment" &&
      currentStatus === "hold_pending_fulfillment"
    ) {
      return "This payout ledger row is already held for fulfillment.";
    }

    const missing = actionRequirements(nextStatus);

    if (missing.length > 0) {
      return `Payout ledger update needs: ${missing.join(", ")}.`;
    }

    return ledgerActionReadyTitle(nextStatus);
  }

  function showLedgerActionBlocked(nextStatus: LedgerStatus) {
    const blockedReason = ledgerActionBlockedReason(nextStatus);

    if (!blockedReason) return false;

    setMessage({ tone: "error", text: blockedReason });
    return true;
  }

  function guardedUpdateStatus(nextStatus: LedgerStatus) {
    if (showLedgerActionBlocked(nextStatus)) return;
    void updateStatus(nextStatus);
  }

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
          onClick={() => guardedUpdateStatus("eligible")}
          aria-busy={loading === "eligible"}
          aria-disabled={
            locked ||
            currentStatus === "eligible" ||
            actionRequirements("eligible").length > 0
          }
          title={ledgerActionTitle("eligible")}
          className={`rounded-2xl px-3 py-2 text-xs font-black text-white ${
            locked ||
            currentStatus === "eligible" ||
            actionRequirements("eligible").length > 0
              ? "cursor-not-allowed bg-neutral-400"
              : "bg-emerald-700"
          }`}
        >
          {actionLabel("eligible") || "Release"}
        </button>
        <button
          type="button"
          onClick={() => guardedUpdateStatus("hold_dispute_or_review")}
          aria-busy={loading === "hold_dispute_or_review"}
          aria-disabled={
            locked ||
            currentStatus === "hold_dispute_or_review" ||
            actionRequirements("hold_dispute_or_review").length > 0
          }
          title={ledgerActionTitle("hold_dispute_or_review")}
          className={`rounded-2xl px-3 py-2 text-xs font-black text-white ${
            locked ||
            currentStatus === "hold_dispute_or_review" ||
            actionRequirements("hold_dispute_or_review").length > 0
              ? "cursor-not-allowed bg-neutral-400"
              : "bg-amber-700"
          }`}
        >
          {actionLabel("hold_dispute_or_review") || "Review Hold"}
        </button>
        <button
          type="button"
          aria-disabled={locked || currentStatus === "hold_pending_fulfillment"}
          onClick={() => guardedUpdateStatus("hold_pending_fulfillment")}
          aria-busy={loading === "hold_pending_fulfillment"}
          title={ledgerActionTitle("hold_pending_fulfillment")}
          className={`rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black ${
            locked || currentStatus === "hold_pending_fulfillment"
              ? "cursor-not-allowed text-neutral-400"
              : ""
          }`}
        >
          {actionLabel("hold_pending_fulfillment") || "Fulfill Hold"}
        </button>
        <button
          type="button"
          onClick={() => guardedUpdateStatus("reversed")}
          aria-busy={loading === "reversed"}
          aria-disabled={locked || actionRequirements("reversed").length > 0}
          title={ledgerActionTitle("reversed")}
          className={`rounded-2xl border border-rose-300 bg-white px-3 py-2 text-xs font-black ${
            locked || actionRequirements("reversed").length > 0
              ? "cursor-not-allowed text-neutral-400"
              : "text-rose-700"
          }`}
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
        onClick={() => guardedUpdateStatus("cancelled")}
        aria-busy={loading === "cancelled"}
        aria-disabled={locked || actionRequirements("cancelled").length > 0}
        title={ledgerActionTitle("cancelled")}
        className={`rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black ${
          locked || actionRequirements("cancelled").length > 0
            ? "cursor-not-allowed text-neutral-400"
            : ""
        }`}
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
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-2xl border px-3 py-2 text-xs font-black ${className}`}
    >
      {children}
    </p>
  );
}
