"use client";

import { useState } from "react";

export default function ShippingLabelActions({ orderId }: { orderId: number }) {
  const [preparing, setPreparing] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [message, setMessage] = useState("");

  async function prepareLabelRecord() {
    setPreparing(true);
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
      setPreparing(false);
    }
  }

  async function attemptProviderPurchase() {
    setPurchasing(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/orders/${orderId}/shipping-labels`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const blockerText = Array.isArray(data.blockers)
          ? data.blockers
              .map((item: { label?: string; missing?: string[] }) =>
                `${item.label || "Provider"}: ${
                  item.missing?.join(", ") || "missing credentials"
                }`,
              )
              .join(" / ")
          : "";
        setMessage(
          `${data.error || "Provider purchase blocked."}${
            blockerText ? ` Missing: ${blockerText}` : ""
          }`,
        );
        return;
      }

      setMessage(
        data.message ||
          "Provider credentials are ready; live purchase adapter still needs to be connected.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not attempt provider purchase.");
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={prepareLabelRecord}
          disabled={preparing || purchasing}
          className="rounded bg-neutral-950 px-4 py-2 font-bold text-white disabled:opacity-50"
        >
          {preparing ? "Preparing..." : "Prepare Label + Coverage Record"}
        </button>

        <button
          onClick={attemptProviderPurchase}
          disabled={preparing || purchasing}
          className="rounded border border-neutral-950 bg-white px-4 py-2 font-bold text-neutral-950 disabled:opacity-50"
        >
          {purchasing ? "Checking..." : "Attempt Provider Purchase"}
        </button>
      </div>

      {message ? (
        <div className="rounded border bg-gray-50 p-3 text-sm font-semibold">
          {message}
        </div>
      ) : null}
    </div>
  );
}
