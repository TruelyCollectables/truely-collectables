"use client";

import { useState } from "react";

export default function ShippingLabelActions({ orderId }: { orderId: number }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function prepareLabelRecord() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/orders/${orderId}/shipping-labels`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not prepare label record.");
        return;
      }

      setMessage(
        data.reused
          ? "Existing active label record is already prepared."
          : "Label and coverage record prepared. Provider purchase still required.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not prepare label record.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={prepareLabelRecord}
        disabled={loading}
        className="rounded bg-neutral-950 px-4 py-2 font-bold text-white disabled:opacity-50"
      >
        {loading ? "Preparing..." : "Prepare Label + Coverage Record"}
      </button>

      {message ? (
        <div className="rounded border bg-gray-50 p-3 text-sm font-semibold">
          {message}
        </div>
      ) : null}
    </div>
  );
}
