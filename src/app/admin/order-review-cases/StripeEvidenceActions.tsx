"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function label(value: string | null | undefined) {
  return String(value || "not_staged").replaceAll("_", " ").toUpperCase();
}

export default function StripeEvidenceActions({
  caseId,
  disputeId,
  status,
  dueBy,
  error,
}: {
  caseId: string;
  disputeId: string;
  status: string | null;
  dueBy: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"stage" | "submit" | null>(null);
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const normalizedStatus = status || "not_staged";
  const stageLocked = ["staged", "submitted", "won", "lost"].includes(
    normalizedStatus,
  );
  const canSubmit = normalizedStatus === "staged";

  async function stage() {
    setBusy("stage");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/order-review-cases/${caseId}/stripe-evidence`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not stage evidence.");
      setMessage("Evidence staged in Stripe for review.");
      router.refresh();
    } catch (stageError: any) {
      setMessage(stageError.message || "Could not stage evidence.");
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (confirmation !== "SUBMIT TO STRIPE") {
      setMessage("Type SUBMIT TO STRIPE exactly before final submission.");
      return;
    }

    setBusy("submit");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/order-review-cases/${caseId}/stripe-evidence`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not submit evidence.");
      setMessage("Evidence submitted to Stripe.");
      setShowSubmitConfirmation(false);
      setConfirmation("");
      router.refresh();
    } catch (submitError: any) {
      setMessage(submitError.message || "Could not submit evidence.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
      <p className="font-black">Stripe Dispute Defense</p>
      <p className="mt-1 break-all text-xs">Dispute {disputeId}</p>
      <p className="mt-2 font-bold">Evidence: {label(normalizedStatus)}</p>
      <p className="mt-1 text-xs">
        Deadline: {dueBy ? new Date(dueBy).toLocaleString() : "Not provided"}
      </p>
      {error ? <p className="mt-2 text-xs font-bold">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={stage}
          disabled={busy !== null || stageLocked}
          className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-50"
        >
          {busy === "stage" ? "Staging..." : "Generate And Stage"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowSubmitConfirmation(true);
            setConfirmation("");
            setMessage("");
          }}
          disabled={busy !== null || !canSubmit}
          className="rounded-md bg-rose-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          {busy === "submit" ? "Submitting..." : "Final Submit To Stripe"}
        </button>
      </div>

      {showSubmitConfirmation ? (
        <div className="mt-3 rounded-md border border-rose-300 bg-white p-3">
          <p className="text-xs font-black">
            Final submission cannot be edited after it is sent to the issuing bank.
          </p>
          <label className="mt-2 block text-xs font-bold">
            Type <code>SUBMIT TO STRIPE</code>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
              placeholder="SUBMIT TO STRIPE"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy !== null}
              className="rounded bg-rose-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {busy === "submit" ? "Submitting..." : "Submit final evidence"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSubmitConfirmation(false);
                setConfirmation("");
              }}
              disabled={busy !== null}
              className="rounded border border-neutral-300 px-3 py-2 text-xs font-black disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-xs">
        Staging is editable. Final submission is sent to the bank and cannot be amended.
      </p>
      {message ? <p className="mt-2 text-xs font-bold">{message}</p> : null}
    </div>
  );
}
