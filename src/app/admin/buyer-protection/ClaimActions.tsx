"use client";

import { useState } from "react";

export default function ClaimActions(props: {
  claimId: string;
  status: string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function act(action: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        "/api/admin/buyer-protection/claims/update",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId: props.claimId,
            action,
            note,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Claim action failed");
      }

      setMessage(
        action === "reimbursed"
          ? `Stripe reimbursement completed${payload.refundId ? `: ${payload.refundId}` : ""}.`
          : `Claim marked ${action.replaceAll("_", " ")}.`,
      );
      setTimeout(() => window.location.reload(), 700);
    } catch (actionError: any) {
      setError(actionError.message || "Claim action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded border border-neutral-200 bg-neutral-50 p-4">
      <label className="block text-sm font-black" htmlFor={`note-${props.claimId}`}>
        Decision / override note
      </label>
      <textarea
        id={`note-${props.claimId}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={1500}
        className="min-h-24 w-full rounded border bg-white p-3 text-sm"
        placeholder="Required for approve or deny. Delivered-scan exceptions must include a detailed override reason."
      />

      <div className="flex flex-wrap gap-2">
        {props.status === "submitted" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("under_review")}
            className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-black text-blue-950 disabled:opacity-50"
          >
            Start Review
          </button>
        ) : null}
        {["submitted", "under_review"].includes(props.status) ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("approved")}
              className="rounded bg-emerald-700 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              Approve Item Amount
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("denied")}
              className="rounded bg-red-700 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              Deny
            </button>
          </>
        ) : null}
        {props.status === "approved" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("reimbursed")}
            className="rounded bg-violet-800 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            Issue Stripe Reimbursement
          </button>
        ) : null}
      </div>

      {message ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-950">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-950">
          {error}
        </p>
      ) : null}
    </div>
  );
}
