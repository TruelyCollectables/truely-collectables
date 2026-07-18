"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PayoutStatus =
  | "requested"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "cancelled";

export default function PayoutRequestActions({
  requestId,
  status,
  reviewBlocked,
  reviewGuardUnavailable,
  reviewBlockReason,
  payoutAccountReady,
  payoutAccountBlockReason,
}: {
  requestId: string;
  status: string | null;
  reviewBlocked?: boolean;
  reviewGuardUnavailable?: boolean;
  reviewBlockReason?: string | null;
  payoutAccountReady?: boolean;
  payoutAccountBlockReason?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [providerPayoutReference, setProviderPayoutReference] = useState("");
  const [finalProcessorFeeAmount, setFinalProcessorFeeAmount] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  function actionRequirements(nextStatus: PayoutStatus) {
    const missing = [];

    if (
      (nextStatus === "rejected" || nextStatus === "cancelled") &&
      adminNote.trim().length < 8
    ) {
      missing.push("audit note");
    }

    if (
      nextStatus === "paid" &&
      providerPayoutReference.trim().length === 0
    ) {
      missing.push("provider payout reference");
    }

    const processorFee = finalProcessorFeeAmount.trim()
      ? Number(finalProcessorFeeAmount)
      : 0;
    if (nextStatus === "paid" && (!Number.isFinite(processorFee) || processorFee < 0)) {
      missing.push("valid processor fee");
    }

    return missing;
  }

  async function updateStatus(nextStatus: PayoutStatus) {
    const missing = actionRequirements(nextStatus);
    if (missing.length > 0) {
      setMessage({
        tone: "error",
        text: `Payout request needs: ${missing.join(", ")}.`,
      });
      return;
    }

    setLoading(nextStatus);
    setMessage({ tone: "info", text: "Saving payout request status..." });

    try {
      const response = await fetch("/api/admin/seller-payouts/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          status: nextStatus,
          adminNote: adminNote.trim(),
          providerPayoutReference: providerPayoutReference.trim(),
          finalProcessorFeeAmount: finalProcessorFeeAmount.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Could not update payout request.",
        });
        return;
      }

      setAdminNote("");
      setProviderPayoutReference("");
      setFinalProcessorFeeAmount("");
      setMessage({
        tone: "success",
        text: `Payout request moved to ${nextStatus}.`,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({
        tone: "error",
        text: "Could not update payout request.",
      });
    } finally {
      setLoading("");
    }
  }

  const currentStatus = status || "requested";
  const terminalStatus =
    currentStatus === "paid" ||
    currentStatus === "rejected" ||
    currentStatus === "cancelled";
  const locked = terminalStatus || loading !== "";
  const payoutAdvanceBlocked = Boolean(
    reviewBlocked || reviewGuardUnavailable || payoutAccountReady === false,
  );
  const visibleRequirements = Array.from(
    new Set(
      ([
        "approved",
        "processing",
        "paid",
        "rejected",
        "cancelled",
      ] as PayoutStatus[]).flatMap((nextStatus) => actionRequirements(nextStatus)),
    ),
  );

  return (
    <div className="grid gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <input
        value={adminNote}
        onChange={(event) => setAdminNote(event.target.value)}
        className="w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
        placeholder="Admin note / audit reason"
      />

      {currentStatus === "processing" ? (
        <div className="grid gap-2 rounded border border-neutral-200 bg-neutral-50 p-2">
          <input
            value={providerPayoutReference}
            onChange={(event) =>
              setProviderPayoutReference(event.target.value)
            }
            className="w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
            placeholder="Provider payout reference"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={finalProcessorFeeAmount}
            onChange={(event) =>
              setFinalProcessorFeeAmount(event.target.value)
            }
            className="w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
            placeholder="Final processor fee"
          />
        </div>
      ) : null}

      {visibleRequirements.length > 0 ? (
        <ActionNotice tone="info">
          Some status actions require: {visibleRequirements.join(", ")}.
        </ActionNotice>
      ) : null}

      {payoutAccountReady === false ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          {payoutAccountBlockReason ||
            "Seller Stripe payout verification must be active before this request can advance."}
        </p>
      ) : null}

      {reviewGuardUnavailable ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          Review guard unavailable. Case checks must load before this request can
          be approved or paid.
        </p>
      ) : reviewBlocked ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          {reviewBlockReason ||
            "This request is blocked by an active case or held payout rows."}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={
            locked ||
            currentStatus !== "requested" ||
            payoutAdvanceBlocked
          }
          onClick={() => updateStatus("approved")}
          className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {loading === "approved" ? "Saving..." : "Approve"}
        </button>
        <button
          type="button"
          disabled={
            locked || currentStatus !== "approved" || payoutAdvanceBlocked
          }
          onClick={() => updateStatus("processing")}
          className="rounded-2xl bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {loading === "processing" ? "Saving..." : "Processing"}
        </button>
        <button
          type="button"
          onClick={() => updateStatus("paid")}
          disabled={
            locked ||
            currentStatus !== "processing" ||
            actionRequirements("paid").length > 0 ||
            payoutAdvanceBlocked
          }
          className="rounded-2xl bg-emerald-950 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {loading === "paid" ? "Saving..." : "Mark Paid"}
        </button>
        <button
          type="button"
          onClick={() => updateStatus("rejected")}
          disabled={locked || actionRequirements("rejected").length > 0}
          className="rounded-2xl border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          {loading === "rejected" ? "Saving..." : "Reject"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => updateStatus("cancelled")}
        disabled={locked || actionRequirements("cancelled").length > 0}
        className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:text-neutral-400"
      >
        {loading === "cancelled" ? "Saving..." : "Cancel Request"}
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
    <p className={`rounded-2xl border px-3 py-2 text-xs font-black ${className}`}>
      {children}
    </p>
  );
}
