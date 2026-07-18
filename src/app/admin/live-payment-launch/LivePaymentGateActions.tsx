"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function LivePaymentGateActions({
  approvalReady,
  approvalDatabaseReady,
}: {
  approvalReady: boolean;
  approvalDatabaseReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "revoke" | null>(null);
  const gateActionRunningRef = useRef(false);
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
  const approveDisabledReason = !approvalDatabaseReady
    ? "Apply the live-payment launch gate migration before recording approval."
    : !approvalReady
      ? "Clear the live-payment approval blockers before recording approval."
      : busy !== null
        ? "Finish the current live-payment gate action first."
        : "";
  const revokeDisabledReason =
    busy !== null ? "Finish the current live-payment gate action first." : "";

  async function submit(action: "approve" | "revoke") {
    if (gateActionRunningRef.current) {
      setMessage({
        tone: "error",
        text: "Finish the current live-payment gate action first.",
      });
      return;
    }

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

    gateActionRunningRef.current = true;
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
      gateActionRunningRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-current/20 bg-white/70 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em]">
          Gate action
        </p>
        <p className="mt-1 text-sm font-semibold leading-6">
          Approval writes to the immutable audit log. Runtime checkout still
          requires the environment kill switch; revocation closes the database
          approval immediately.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!approvalReady || !approvalDatabaseReady || busy !== null}
          aria-busy={busy === "approve"}
          title={approveDisabledReason || "Open the confirmation panel for live payment approval."}
          onClick={() => {
            setPendingAction("approve");
            setConfirmation("");
            setMessage(null);
          }}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-black text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "approve" ? "Approving..." : "Approve Live Payments"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          aria-busy={busy === "revoke"}
          title={revokeDisabledReason || "Open the confirmation panel for emergency live payment revocation."}
          onClick={() => {
            setPendingAction("revoke");
            setConfirmation("");
            setMessage(null);
          }}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "revoke" ? "Revoking..." : "Emergency Revoke"}
        </button>
      </div>
      {!approvalDatabaseReady ? (
        <p
          role="alert"
          aria-live="assertive"
          className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950"
        >
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
          onSubmit={() => void submit(pendingAction)}
        />
      ) : null}
      {message ? (
        <ActionNotice tone={message.tone}>{message.text}</ActionNotice>
      ) : null}
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
      className={`rounded-2xl border p-4 ${
        isRevoke
          ? "border-red-200 bg-red-50 text-red-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-950"
      }`}
    >
      <p className="text-sm font-black">
        {isRevoke ? "Confirm emergency revocation" : "Confirm live payment approval"}
      </p>
      <p className="mt-1 text-xs font-bold leading-5">
        Type <code>{expected}</code>, add the operator name, then submit.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="text-xs font-black">
          Confirmation phrase
          <input
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder={expected}
          />
        </label>
        <label className="text-xs font-black">
          Operator
          <input
            value={operator}
            onChange={(event) => onOperatorChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder="Name for audit log"
          />
        </label>
        <label className="text-xs font-black md:col-span-2">
          Note
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
            placeholder="Optional launch/revocation note"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          aria-busy={busy}
          title={
            busy
              ? "Live payment gate submission is already running."
              : isRevoke
                ? "Record the emergency live payment revocation in the immutable audit log."
                : "Record the live payment approval in the immutable audit log."
          }
          className={`rounded-md px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${
            isRevoke
              ? "bg-red-700 hover:bg-red-800"
              : "bg-emerald-700 hover:bg-emerald-800"
          }`}
        >
          {busy ? "Submitting..." : isRevoke ? "Revoke approval" : "Record approval"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          title={
            busy
              ? "Wait for the live payment gate submission to finish before cancelling."
              : "Close this confirmation panel without recording a gate change."
          }
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
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
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`w-full rounded-xl border px-3 py-2 text-sm font-bold ${className}`}
    >
      {children}
    </p>
  );
}
