"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const gateActionPanelClass =
  "grid gap-3 rounded-3xl border border-current/20 bg-white/80 p-4 shadow-sm ring-1 ring-black/[0.02]";
const gateApproveButtonClass =
  "rounded-full bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const gateRevokeButtonClass =
  "rounded-full bg-red-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const gateNeutralButtonClass =
  "rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const gateInputClass =
  "mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-950 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

export default function LiveShippingGateActions({
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
    ? "Apply the live-shipping launch gate migration before recording approval."
    : !approvalReady
      ? "Clear the live-shipping approval blockers before recording approval."
      : busy !== null
        ? "Finish the current live-shipping gate action first."
        : "";
  const revokeDisabledReason =
    busy !== null ? "Finish the current live-shipping gate action first." : "";

  function beginAction(action: "approve" | "revoke") {
    if (gateActionRunningRef.current || busy !== null) {
      setMessage({
        tone: "info",
        text: "Finish the current live-shipping gate action first.",
      });
      return;
    }

    if (action === "approve" && approveDisabledReason) {
      setMessage({
        tone: "error",
        text: approveDisabledReason,
      });
      return;
    }

    setPendingAction(action);
    setConfirmation("");
    setMessage(null);
  }

  function cancelAction() {
    if (gateActionRunningRef.current || busy !== null) {
      setMessage({
        tone: "info",
        text: "Wait for the live shipping gate submission to finish before cancelling.",
      });
      return;
    }

    setPendingAction(null);
    setConfirmation("");
    setOperator("");
    setNote("");
  }

  async function submit(action: "approve" | "revoke") {
    if (gateActionRunningRef.current) {
      setMessage({
        tone: "error",
        text: "Finish the current live-shipping gate action first.",
      });
      return;
    }

    const expected =
      action === "approve" ? "APPROVE LIVE SHIPPING" : "REVOKE LIVE SHIPPING";

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
          ? "Recording live shipping approval..."
          : "Recording emergency shipping revocation...",
    });
    try {
      const response = await fetch("/api/admin/live-shipping-launch", {
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
            ? "Database approval recorded. Live shipping still requires the environment kill switch and live purchase mode."
            : "Live shipping approval revoked.",
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
    <div className={gateActionPanelClass}>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em]">
          Gate action
        </p>
        <p className="mt-1 text-sm font-semibold leading-6">
          Approval writes to the immutable audit log. Runtime shipping still
          requires the environment kill switch and live purchase mode; revocation
          closes the database approval immediately.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          aria-disabled={!approvalReady || !approvalDatabaseReady || busy !== null}
          aria-busy={busy === "approve"}
          title={approveDisabledReason || "Open the confirmation panel for live shipping approval."}
          onClick={() => beginAction("approve")}
          className={gateApproveButtonClass}
        >
          {busy === "approve" ? "Approving..." : "Approve Live Shipping"}
        </button>
        <button
          type="button"
          aria-disabled={busy !== null}
          aria-busy={busy === "revoke"}
          title={revokeDisabledReason || "Open the confirmation panel for emergency live shipping revocation."}
          onClick={() => beginAction("revoke")}
          className={gateRevokeButtonClass}
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
          Approval is disabled until the live-shipping launch gate migration is
          applied.
        </p>
      ) : null}
      {pendingAction ? (
        <LaunchConfirmationPanel
          action={pendingAction}
          confirmation={confirmation}
          expected={
            pendingAction === "approve"
              ? "APPROVE LIVE SHIPPING"
              : "REVOKE LIVE SHIPPING"
          }
          note={note}
          operator={operator}
          busy={busy !== null}
          onCancel={cancelAction}
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
        {isRevoke ? "Confirm emergency revocation" : "Confirm live shipping approval"}
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
            className={gateInputClass}
            placeholder={expected}
          />
        </label>
        <label className="text-xs font-black">
          Operator
          <input
            value={operator}
            onChange={(event) => onOperatorChange(event.target.value)}
            className={gateInputClass}
            placeholder="Name for audit log"
          />
        </label>
        <label className="text-xs font-black md:col-span-2">
          Note
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className={gateInputClass}
            placeholder="Optional launch/revocation note"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSubmit}
          aria-disabled={busy}
          aria-busy={busy}
          title={
            busy
              ? "Live shipping gate submission is already running."
              : isRevoke
                ? "Record the emergency live shipping revocation in the immutable audit log."
                : "Record the live shipping approval in the immutable audit log."
          }
          className={isRevoke ? gateRevokeButtonClass : gateApproveButtonClass}
        >
          {busy ? "Submitting..." : isRevoke ? "Revoke approval" : "Record approval"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-disabled={busy}
          title={
            busy
              ? "Wait for the live shipping gate submission to finish before cancelling."
              : "Close this confirmation panel without recording a gate change."
          }
          className={gateNeutralButtonClass}
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
      className={`w-full rounded-2xl border px-3 py-2 text-sm font-bold shadow-sm ${className}`}
    >
      {children}
    </p>
  );
}
