"use client";

import { useState } from "react";

export function MarkOrderShippedButton({
  orderId,
  carrier,
  trackingNumber,
}: {
  orderId: number;
  carrier: string;
  trackingNumber: string;
}) {
  const [shipping, setShipping] = useState(false);
  const [message, setMessage] = useState("");

  async function markShipped() {
    setShipping(true);
    setMessage("");

    try {
      const trackingResponse = await fetch("/api/orders/update-tracking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          carrier,
          trackingNumber,
        }),
      });
      const trackingData = await trackingResponse.json().catch(() => ({}));

      if (!trackingResponse.ok) {
        setMessage(trackingData.error || "Could not save tracking.");
        return;
      }

      const shippedResponse = await fetch("/api/orders/mark-shipped", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId }),
      });
      const shippedData = await shippedResponse.json().catch(() => ({}));

      if (!shippedResponse.ok) {
        setMessage(shippedData.error || "Could not mark shipped.");
        return;
      }

      setMessage(
        shippedData.emailSent
          ? "Order marked shipped and email sent."
          : "Order marked shipped.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error: any) {
      setMessage(error.message || "Could not mark shipped.");
    } finally {
      setShipping(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={markShipped}
        disabled={shipping}
        className="rounded bg-green-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {shipping ? "Marking..." : "Mark Shipped"}
      </button>
      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
