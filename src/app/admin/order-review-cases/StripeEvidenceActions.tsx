"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

function label(value: string | null | undefined) {
  return String(value || "not_staged").replaceAll("_", " ").toUpperCase();
}

type FeedbackTone = "info" | "success" | "error";

type FeedbackMessage = {
  text: string;
  tone: FeedbackTone;
};

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
  const evidenceActionRunningRef = useRef(false);
  const [busy, setBusy] = useState<"stage" | "submit" | null>(null);
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const normalizedStatus = status || "not_staged";
  const stageLocked = ["staged", "submitted", "won", "lost"].includes(
    normalizedStatus,
  );
  const canSubmit = normalizedStatus === "staged";
  const stageButtonTitle =
    busy !== null
      ? "Finish the current Stripe evidence action before staging evidence."
      : stageLocked
        ? `Evidence is already ${label(normalizedStatus).toLowerCase()}; generate/stage is locked.`
        : "Generate and stage editable Stripe dispute evidence.";
  const submitButtonTitle =
    busy !== null
      ? "Finish the current Stripe evidence action before final submission."
      : !canSubmit
        ? "Stage Stripe evidence before final submission."
        : "Open the final Stripe evidence submission confirmation.";
  const finalSubmitTitle =
    busy !== null
      ? "Finish the current Stripe evidence action before final submission."
      : confirmation !== "SUBMIT TO STRIPE"
        ? "Type SUBMIT TO STRIPE exactly before final submission."
        : "Submit final evidence to Stripe and the issuing bank.";
  const cancelSubmitTitle =
    busy !== null
      ? "Wait for the Stripe evidence action to finish before closing this confirmation."
      : "Close this Stripe final-submission confirmation.";

  async function stage() {
    if (evidenceActionRunningRef.current || busy !== null) {
      setMessage({ text: "Stripe evidence action is already running.", tone: "info" });
      return;
    }

    if (stageLocked) {
      setMessage({
        text: `Evidence is already ${label(normalizedStatus).toLowerCase()}; generate/stage is locked.`,
        tone: "error",
      });
      return;
    }

    evidenceActionRunningRef.current = true;
    setBusy("stage");
    setMessage({ text: "Generating and staging Stripe evidence...", tone: "info" });
    try {
      const response = await fetch(
        `/api/admin/order-review-cases/${caseId}/stripe-evidence`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not stage evidence.");
      setMessage({
        text: "Evidence staged in Stripe for review.",
        tone: "success",
      });
      router.refresh();
    } catch (stageError: any) {
      setMessage({
        text: stageError.message || "Could not stage evidence.",
        tone: "error",
      });
    } finally {
      evidenceActionRunningRef.current = false;
      setBusy(null);
    }
  }

  function beginSubmitConfirmation() {
    if (evidenceActionRunningRef.current || busy !== null) {
      setMessage({ text: "Stripe evidence action is already running.", tone: "info" });
      return;
    }

    if (!canSubmit) {
      setMessage({
        text: "Stage Stripe evidence before final submission.",
        tone: "error",
      });
      return;
    }

    setShowSubmitConfirmation(true);
    setConfirmation("");
    setMessage(null);
  }

  async function submit() {
    if (evidenceActionRunningRef.current || busy !== null) {
      setMessage({ text: "Stripe evidence action is already running.", tone: "info" });
      return;
    }

    if (!canSubmit) {
      setMessage({
        text: "Stripe evidence must be staged before final submission.",
        tone: "error",
      });
      return;
    }

    if (confirmation !== "SUBMIT TO STRIPE") {
      setMessage({
        text: "Type SUBMIT TO STRIPE exactly before final submission.",
        tone: "error",
      });
      return;
    }

    evidenceActionRunningRef.current = true;
    setBusy("submit");
    setMessage({ text: "Submitting final evidence to Stripe...", tone: "info" });
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
      setMessage({
        text: "Evidence submitted to Stripe.",
        tone: "success",
      });
      setShowSubmitConfirmation(false);
      setConfirmation("");
      router.refresh();
    } catch (submitError: any) {
      setMessage({
        text: submitError.message || "Could not submit evidence.",
        tone: "error",
      });
    } finally {
      evidenceActionRunningRef.current = false;
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
          aria-disabled={busy !== null || stageLocked}
          aria-busy={busy === "stage"}
          title={stageButtonTitle}
          className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-black aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {busy === "stage" ? "Staging..." : "Generate And Stage"}
        </button>
        <button
          type="button"
          onClick={beginSubmitConfirmation}
          aria-disabled={busy !== null || !canSubmit}
          aria-busy={busy === "submit"}
          title={submitButtonTitle}
          className="rounded-md bg-rose-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
              aria-disabled={busy !== null}
              aria-busy={busy === "submit"}
              title={finalSubmitTitle}
              className="rounded bg-rose-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {busy === "submit" ? "Submitting..." : "Submit final evidence"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (busy !== null) {
                  setMessage({
                    text: "Wait for the Stripe evidence action to finish before closing this confirmation.",
                    tone: "info",
                  });
                  return;
                }
                setShowSubmitConfirmation(false);
                setConfirmation("");
              }}
              aria-disabled={busy !== null}
              title={cancelSubmitTitle}
              className="rounded border border-neutral-300 px-3 py-2 text-xs font-black aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-xs">
        Staging is editable. Final submission is sent to the bank and cannot be amended.
      </p>
      <ActionMessage message={message} />
    </div>
  );
}

function ActionMessage({ message }: { message: FeedbackMessage | null }) {
  if (!message) return null;

  const className =
    message.tone === "success"
      ? "text-emerald-700"
      : message.tone === "error"
        ? "text-rose-700"
        : "text-rose-950";

  return (
    <p
      aria-live={message.tone === "info" ? "polite" : "assertive"}
      className={`mt-2 text-xs font-bold ${className}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}
