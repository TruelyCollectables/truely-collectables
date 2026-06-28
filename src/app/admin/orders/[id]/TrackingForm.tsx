"use client";

import { useState } from "react";

export default function TrackingForm({
  orderId,
  currentCarrier,
  currentTrackingNumber,
}: {
  orderId: number;
  currentCarrier: string;
  currentTrackingNumber: string;
}) {
  const [carrier, setCarrier] = useState(currentCarrier || "USPS");
  const [trackingNumber, setTrackingNumber] = useState(
    currentTrackingNumber || ""
  );
  const [saving, setSaving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [message, setMessage] = useState("");

  async function saveTracking() {
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/orders/update-tracking", {
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

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Failed to save tracking.");
        return;
      }

      setMessage("Tracking saved.");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function markShipped() {
    setShipping(true);
    setMessage("");

    try {
      const save = await fetch("/api/orders/update-tracking", {
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

      const saveData = await save.json();

      if (!save.ok) {
        setMessage(saveData.error || "Unable to save tracking.");
        return;
      }

      const ship = await fetch("/api/orders/mark-shipped", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
        }),
      });

      const shipData = await ship.json();

      if (!ship.ok) {
        setMessage(shipData.error || "Unable to mark shipped.");
        return;
      }

      setMessage("Order marked shipped.");

      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setShipping(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block font-bold mb-2">Carrier</label>

        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        >
          <option>USPS</option>
          <option>UPS</option>
          <option>FedEx</option>
          <option>Canada Post</option>
          <option>Other</option>
        </select>
      </div>

      <div>
        <label className="block font-bold mb-2">Tracking Number</label>

        <input
          className="border rounded px-3 py-2 w-full"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="9405..."
        />
      </div>

      <div className="flex gap-4">
        <button
          onClick={saveTracking}
          disabled={saving}
          className="bg-blue-600 text-white px-5 py-2 rounded disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Tracking"}
        </button>

        <button
          onClick={markShipped}
          disabled={shipping}
          className="bg-green-600 text-white px-5 py-2 rounded disabled:opacity-50"
        >
          {shipping ? "Shipping..." : "Mark Shipped"}
        </button>
      </div>

      {message && <div className="border rounded bg-gray-50 p-3">{message}</div>}
    </div>
  );
}
