"use client";

import { useMemo, useState } from "react";

type ClaimStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "paid"
  | "denied"
  | "cancelled";

const statusActions: Record<
  ClaimStatus,
  { status: ClaimStatus; label: string; tone: string }[]
> = {
  draft: [
    {
      status: "submitted",
      label: "Submit",
      tone: "bg-neutral-950 text-white",
    },
    {
      status: "cancelled",
      label: "Cancel",
      tone: "border border-neutral-300 bg-white text-neutral-950",
    },
  ],
  submitted: [
    {
      status: "under_review",
      label: "Mark Review",
      tone: "border border-amber-700 bg-amber-50 text-amber-950",
    },
    {
      status: "approved",
      label: "Approve",
      tone: "border border-green-700 bg-green-50 text-green-950",
    },
    {
      status: "denied",
      label: "Deny",
      tone: "border border-red-700 bg-red-50 text-red-950",
    },
    {
      status: "cancelled",
      label: "Cancel",
      tone: "border border-neutral-300 bg-white text-neutral-950",
    },
  ],
  under_review: [
    {
      status: "approved",
      label: "Approve",
      tone: "border border-green-700 bg-green-50 text-green-950",
    },
    {
      status: "denied",
      label: "Deny",
      tone: "border border-red-700 bg-red-50 text-red-950",
    },
    {
      status: "cancelled",
      label: "Cancel",
      tone: "border border-neutral-300 bg-white text-neutral-950",
    },
  ],
  approved: [
    {
      status: "paid",
      label: "Mark Paid",
      tone: "bg-green-700 text-white",
    },
    {
      status: "denied",
      label: "Deny",
      tone: "border border-red-700 bg-red-50 text-red-950",
    },
    {
      status: "cancelled",
      label: "Cancel",
      tone: "border border-neutral-300 bg-white text-neutral-950",
    },
  ],
  paid: [],
  denied: [],
  cancelled: [],
};

function normalizeStatus(value: string | null | undefined): ClaimStatus {
  if (
    value === "submitted" ||
    value === "under_review" ||
    value === "approved" ||
    value === "paid" ||
    value === "denied" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "draft";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function yesNo(value: unknown) {
  return value === true ? "Yes" : "No";
}

function gateTone(evidence: Record<string, unknown>) {
  if (evidence.deliveredEvidencePresent === true) {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (evidence.claimReviewSupported === true) {
    return "border-green-200 bg-green-50 text-green-950";
  }

  return "border-amber-200 bg-amber-50 text-amber-950";
}

function evidenceCard(params: {
  title: string;
  evidence: Record<string, unknown>;
  reason?: unknown;
  intro?: string;
}) {
  const { title, evidence, reason, intro } = params;

  return (
    <div
      className={`rounded border p-3 text-xs font-semibold ${gateTone(
        evidence,
      )}`}
    >
      <p className="font-black uppercase tracking-widest">{title}</p>
      {intro ? <p className="mt-1">{intro}</p> : null}
      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Delivered evidence
          </dt>
          <dd>{yesNo(evidence.deliveredEvidencePresent)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Claim-review support
          </dt>
          <dd>{yesNo(evidence.claimReviewSupported)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Latest status
          </dt>
          <dd>{String(evidence.latestStatus || "Not recorded")}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Latest tracking
          </dt>
          <dd>{String(evidence.latestTrackingNumber || "Not recorded")}</dd>
        </div>
      </dl>
      <p className="mt-2">
        {String(
          reason ||
            evidence.claimReviewReason ||
            "TCOS will re-check latest LetterTrack evidence before Mark Paid.",
        )}
      </p>
    </div>
  );
}

export default function ShippingClaimActions({
  claimId,
  claimStatus,
  providerClaimId,
  claimMetadata,
  currentLetterTrackEvidence,
  currentLetterTrackPaymentGate,
}: {
  claimId: string;
  claimStatus: string | null;
  providerClaimId?: string | null;
  claimMetadata?: Record<string, unknown> | null;
  currentLetterTrackEvidence?: Record<string, unknown> | null;
  currentLetterTrackPaymentGate?: Record<string, unknown> | null;
}) {
  const normalizedStatus = normalizeStatus(claimStatus);
  const actions = useMemo(
    () => statusActions[normalizedStatus],
    [normalizedStatus],
  );
  const under20Claim = recordValue(
    recordValue(claimMetadata).under_20_seller_protection_claim,
  );
  const letterTrackEvidence = recordValue(
    recordValue(claimMetadata).lettertrack_delivery_evidence,
  );
  const paymentGate = recordValue(
    recordValue(claimMetadata).latest_lettertrack_seller_protection_payment_gate,
  );
  const paymentGateDecision = recordValue(paymentGate.gate);
  const currentPaymentGateDecision = recordValue(currentLetterTrackPaymentGate);
  const isUnder20SellerProtection = under20Claim.eligible === true;
  const hasLetterTrackEvidence = Object.keys(letterTrackEvidence).length > 0;
  const hasCurrentLetterTrackEvidence =
    Number(recordValue(currentLetterTrackEvidence).eventCount || 0) > 0;
  const [pendingStatus, setPendingStatus] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [providerId, setProviderId] = useState(providerClaimId || "");
  const savedEvidenceCard = hasLetterTrackEvidence ? (
    evidenceCard({
      title: "Saved LetterTrack claim snapshot",
      evidence: letterTrackEvidence,
      reason: paymentGateDecision.reason || letterTrackEvidence.claimReviewReason,
      intro: "Saved on the claim record for audit history.",
    })
  ) : isUnder20SellerProtection ? (
    <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
      Under-$20 seller protection is eligible, but no LetterTrack delivery
      evidence snapshot is saved on this claim yet. Mark Paid will require latest
      not-delivered, delivery-exception, or returned evidence unless the internal
      note contains an explicit override reason.
    </p>
  ) : null;
  const currentEvidenceCard =
    hasCurrentLetterTrackEvidence && currentLetterTrackEvidence
      ? evidenceCard({
          title: "Current LetterTrack evidence",
          evidence: recordValue(currentLetterTrackEvidence),
          reason:
            currentPaymentGateDecision.reason ||
            recordValue(currentLetterTrackEvidence).claimReviewReason,
          intro:
            "Recalculated from the latest tracking events loaded on this admin page.",
        })
      : null;
  const packetLink = (
    <a
      href={`/api/admin/shipping-claims/${claimId}/packet`}
      className="inline-flex rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950"
    >
      Download Evidence Packet
    </a>
  );

  async function updateClaimStatus(status: ClaimStatus) {
    setPendingStatus(status);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/shipping-claims/${claimId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          note: note.trim() || undefined,
          providerClaimId: providerId.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not update coverage claim.");
        return;
      }

      setMessage(data.message || "Coverage claim updated.");
      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not update coverage claim.");
    } finally {
      setPendingStatus("");
    }
  }

  if (actions.length === 0) {
    return (
      <div className="mt-3 space-y-2 rounded border bg-neutral-50 p-3">
        {packetLink}
        {currentEvidenceCard}
        {savedEvidenceCard}
        <p className="text-xs font-semibold text-neutral-600">
          Claim is closed. Status changes are locked for audit safety.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded border bg-neutral-50 p-3">
      {packetLink}
      {currentEvidenceCard}
      {savedEvidenceCard}
      {normalizedStatus === "approved" && isUnder20SellerProtection ? (
        <p className="rounded border border-neutral-200 bg-white p-3 text-xs font-semibold text-neutral-700">
          Before Mark Paid: record buyer refund evidence and confirm LetterTrack
          does not show delivered. If you are overriding delivered or missing
          evidence, include the word “override” and the reason in the internal
          note.
        </p>
      ) : null}
      <input
        value={providerId}
        onChange={(event) => setProviderId(event.target.value)}
        placeholder="Provider claim ID, if available"
        className="w-full rounded border bg-white px-3 py-2 text-sm"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={
          normalizedStatus === "approved" && isUnder20SellerProtection
            ? "Internal note / evidence status. For exceptions, include “override” plus the reason."
            : "Internal note / evidence status"
        }
        rows={2}
        className="w-full rounded border bg-white px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.status}
            onClick={() => updateClaimStatus(action.status)}
            disabled={Boolean(pendingStatus)}
            className={`rounded px-3 py-2 text-xs font-black disabled:opacity-50 ${action.tone}`}
          >
            {pendingStatus === action.status ? "Saving..." : action.label}
          </button>
        ))}
      </div>

      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
