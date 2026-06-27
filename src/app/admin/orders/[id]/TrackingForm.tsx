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
        setMessage(data.error || "Tracking update failed");
        setSaving(false);
        return;
      }

      setMessage("Tracking saved.");
      window.location.reload();
    } catch (error: any) {
      setMessage(error.message || "Tracking update failed");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <label className="block font-bold mb-2">Carrier</label>
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          className="border rounded px-4 py-2 w-full"
        >
          <option value="USPS">USPS</option>
          <option value="UPS">UPS</option>
          <option value="FedEx">FedEx</option>
          <option value="Canada Post">Canada Post</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div>
        <label className="block font-bold mb-2">Tracking Number</label>
        <input
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          className="border rounded px-4 py-2 w-full"
          placeholder="Enter tracking number"
        />
      </div>

      <button
        onClick={saveTracking}
        disabled={saving}
        className="border rounded px-4 py-2"
      >
        {saving ? "Saving..." : "Save Tracking"}
      </button>

      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}