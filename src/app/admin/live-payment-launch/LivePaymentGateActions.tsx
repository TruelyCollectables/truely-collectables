"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LivePaymentGateActions({
  approvalReady,
  approvalDatabaseReady,
}: {
  approvalReady: boolean;
  approvalDatabaseReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "revoke" | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "revoke" | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState("");
  const [operator, setOperator] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function submit(action: "approve" | "revoke") {
    const expected =
      action === "approve" ? "APPROVE LIVE PAYMENTS" : "REVOKE LIVE PAYMENTS";

    if (confirmation !== expected) {
      setMessage({
        tone: "error",
        text: `Type ${expected} exactly before submitting.`,
      });
      return;
    }

    if (!operator.trim()) {
      setMessage({
        tone: "error",
        text: "Operator name is required for the immutable audit log.",
      });
      return;
    }

    setBusy(action);
    setMessage({
      tone: "info",
      text:
        action === "approve"
          ? "Recording live payment approval..."
          : "Recording emergency payment revocation...",
    });
    try {
      const response = await fetch("/api/admin/live-payment-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirmation,
          operator: operator.trim(),
          note,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Gate update failed.");
      setMessage({
        tone: "success",
        text:
          action === "approve"
            ? "Database approval recorded. Live Checkout still requires the environment kill switch."
            : "Live payment approval revoked.",
      });
      setPendingAction(null);
      setConfirmation("");
      setOperator("");
      setNote("");
      router.refresh();
    } catch (error: any) {
      setMessage({
        tone: "error",
        text: error.message || "Gate update failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
      <button
        type="button"
        disabled={!approvalReady || !approvalDatabaseReady || busy !== null}
        onClick={() => {
          setPendingAction("approve");
          setConfirmation("");
          setMessage(null);
        }}
        className="rounded bg-green-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "approve" ? "Approving..." : "Approve Live Payments"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          setPendingAction("revoke");
          setConfirmation("");
          setMessage(null);
        }}
        className="rounded bg-red-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "revoke" ? "Revoking..." : "Emergency Revoke"}
      </button>
      </div>
      {!approvalDatabaseReady ? (
        <p className="w-full text-sm font-bold text-red-800">
          Approval is disabled until the live-payment launch gate migration is
          applied.
        </p>
      ) : null}
      {pendingAction ? (
        <LaunchConfirmationPanel
          action={pendingAction}
          confirmation={confirmation}
          expected={
            pendingAction === "approve"
              ? "APPROVE LIVE PAYMENTS"
              : "REVOKE LIVE PAYMENTS"
          }
          note={note}
          operator={operator}
          busy={busy !== null}
          onCancel={() => {
            setPendingAction(null);
            setConfirmation("");
            setOperator("");
            setNote("");
          }}
          onConfirmationChange={setConfirmation}
          onNoteChange={setNote}
          onOperatorChange={setOperator}
          onSubmit={() => submit(pendingAction)}
        />
      ) : null}
      {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
    </div>
  );
}

function LaunchConfirmationPanel({
  action,
  busy,
  confirmation,
  expected,
  note,
  operator,
  onCancel,
  onConfirmationChange,
  onNoteChange,
  onOperatorChange,
  onSubmit,
}: {
  action: "approve" | "revoke";
  busy: boolean;
  confirmation: string;
  expected: string;
  note: string;
  operator: string;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onOperatorChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const isRevoke = action === "revoke";

  return (
    <div
      className={`rounded-md border p-4 ${
        isRevoke
          ? "border-red-200 bg-red-50 text-red-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-950"
      }`}
    >
      <p className="text-sm font-black">
        {isRevoke ? "Confirm emergency revocation" : "Confirm live payment approval"}
      </p>
      <p className="mt-1 text-xs font-bold">
        Type <code>{expected}</code>, add the operator name, then submit.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="text-xs font-black">
          Confirmation phrase
          <input
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder={expected}
          />
        </label>
        <label className="text-xs font-black">
          Operator
          <input
            value={operator}
            onChange={(event) => onOperatorChange(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder="Name for audit log"
          />
        </label>
        <label className="text-xs font-black md:col-span-2">
          Note
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder="Optional launch/revocation note"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className={`rounded px-4 py-2 text-sm font-black text-white disabled:opacity-50 ${
            isRevoke ? "bg-red-700" : "bg-emerald-700"
          }`}
        >
          {busy ? "Submitting..." : isRevoke ? "Revoke approval" : "Record approval"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-900 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
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
    <p className={`w-full rounded border px-3 py-2 text-sm font-bold ${className}`}>
      {children}
    </p>
  );
}
