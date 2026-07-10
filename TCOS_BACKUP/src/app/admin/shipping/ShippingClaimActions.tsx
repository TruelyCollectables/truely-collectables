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

export default function ShippingClaimActions({
  claimId,
  claimStatus,
  providerClaimId,
}: {
  claimId: string;
  claimStatus: string | null;
  providerClaimId?: string | null;
}) {
  const normalizedStatus = normalizeStatus(claimStatus);
  const actions = useMemo(
    () => statusActions[normalizedStatus],
    [normalizedStatus],
  );
  const [pendingStatus, setPendingStatus] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [providerId, setProviderId] = useState(providerClaimId || "");
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
        <p className="text-xs font-semibold text-neutral-600">
          Claim is closed. Status changes are locked for audit safety.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded border bg-neutral-50 p-3">
      {packetLink}
      <input
        value={providerId}
        onChange={(event) => setProviderId(event.target.value)}
        placeholder="Provider claim ID, if available"
        className="w-full rounded border bg-white px-3 py-2 text-sm"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Internal note / evidence status"
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
