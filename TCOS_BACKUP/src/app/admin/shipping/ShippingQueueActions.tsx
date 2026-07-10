"use client";

import { useState } from "react";

export function SaveTrackingForm({
  orderId,
  defaultCarrier = "USPS",
}: {
  orderId: number;
  defaultCarrier?: string;
}) {
  const [carrier, setCarrier] = useState(defaultCarrier || "USPS");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveTracking() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/orders/update-tracking", {
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
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not save tracking.");
        return;
      }

      setMessage("Tracking saved.");
      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not save tracking.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-neutral-50 p-2">
      <div className="grid grid-cols-1 gap-2">
        <input
          value={carrier}
          onChange={(event) => setCarrier(event.target.value)}
          placeholder="Carrier"
          className="rounded border bg-white px-2 py-1 text-xs"
        />
        <input
          value={trackingNumber}
          onChange={(event) => setTrackingNumber(event.target.value)}
          placeholder="Tracking number or IMb"
          className="rounded border bg-white px-2 py-1 text-xs"
        />
      </div>
      <button
        onClick={saveTracking}
        disabled={saving}
        className="rounded bg-blue-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Tracking"}
      </button>
      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

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
