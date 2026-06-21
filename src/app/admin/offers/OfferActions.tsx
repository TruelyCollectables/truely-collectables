"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OfferActions({
  offerId,
  status,
}: {
  offerId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");

  async function updateStatus(newStatus: string) {
    setLoading(newStatus);

    const res = await fetch("/api/offers/update-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        offerId,
        status: newStatus,
      }),
    });

    setLoading("");

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to update offer");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        disabled={status !== "pending" || loading !== ""}
        onClick={() => updateStatus("accepted")}
        className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
      >
        {loading === "accepted" ? "Accepting..." : "Accept"}
      </button>

      <button
        disabled={status !== "pending" || loading !== ""}
        onClick={() => updateStatus("declined")}
        className="w-full border rounded py-2 disabled:opacity-50"
      >
        {loading === "declined" ? "Declining..." : "Decline"}
      </button>

      <button
        disabled
        className="w-full border rounded py-2 opacity-50"
      >
        Counter Coming Soon
      </button>
    </div>
  );
}