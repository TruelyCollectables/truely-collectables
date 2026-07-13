"use client";

import { useState } from "react";

export function SaveCoveragePolicyForm({
  labelId,
  defaultProvider = "Coverage",
  defaultAmount = "",
}: {
  labelId: string;
  defaultProvider?: string;
  defaultAmount?: string;
}) {
  const [coverageProvider, setCoverageProvider] = useState(
    defaultProvider || "Coverage",
  );
  const [coveragePolicyId, setCoveragePolicyId] = useState("");
  const [coverageAmount, setCoverageAmount] = useState(defaultAmount);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function savePolicy() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/shipping-labels/${labelId}/coverage-policy`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            coverageProvider,
            coveragePolicyId,
            coverageAmount,
            note,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not save Coverage policy.");
        return;
      }

      setMessage(data.message || "Coverage policy saved.");
      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not save Coverage policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-neutral-50 p-2">
      <input
        value={coverageProvider}
        onChange={(event) => setCoverageProvider(event.target.value)}
        placeholder="Coverage provider"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={coveragePolicyId}
        onChange={(event) => setCoveragePolicyId(event.target.value)}
        placeholder="Coverage policy ID"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={coverageAmount}
        onChange={(event) => setCoverageAmount(event.target.value)}
        placeholder="Coverage amount"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Internal note"
        rows={2}
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <button
        onClick={savePolicy}
        disabled={saving}
        className="rounded bg-amber-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Coverage Policy"}
      </button>
      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

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

export function RecordLetterTrackImbForm({
  orderId,
}: {
  orderId: number;
}) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [letterTrackReference, setLetterTrackReference] = useState("");
  const [postageAmount, setPostageAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function recordImb() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/orders/${orderId}/shipping-labels`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "record_lettertrack_imb",
            trackingNumber,
            letterTrackReference,
            postageAmount,
            note,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not record LetterTrack IMb.");
        return;
      }

      setMessage(data.message || "LetterTrack IMb recorded.");
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error: any) {
      setMessage(error.message || "Could not record LetterTrack IMb.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-blue-50 p-2">
      <input
        value={trackingNumber}
        onChange={(event) => setTrackingNumber(event.target.value)}
        placeholder="LetterTrack IMb / tracking reference"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={letterTrackReference}
        onChange={(event) => setLetterTrackReference(event.target.value)}
        placeholder="LetterTrack order/mailpiece ID (optional)"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={postageAmount}
        onChange={(event) => setPostageAmount(event.target.value)}
        placeholder="Postage amount (optional)"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Internal note"
        rows={2}
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <button
        onClick={recordImb}
        disabled={saving}
        className="rounded bg-blue-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {saving ? "Recording..." : "Record LetterTrack IMb"}
      </button>
      {message ? (
        <p className="rounded border bg-white p-2 text-xs font-semibold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function RecordLetterTrackDeliveryEventForm({
  labelId,
  defaultTrackingNumber = "",
}: {
  labelId: string;
  defaultTrackingNumber?: string;
}) {
  const [status, setStatus] = useState("delivered");
  const [trackingNumber, setTrackingNumber] = useState(defaultTrackingNumber);
  const [providerEventId, setProviderEventId] = useState("");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function recordEvidence() {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/shipping-labels/${labelId}/tracking-event`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
            trackingNumber,
            providerEventId,
            location,
            occurredAt,
            note,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not record delivery evidence.");
        return;
      }

      setMessage(data.message || "Delivery evidence recorded.");
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error: any) {
      setMessage(error.message || "Could not record delivery evidence.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-green-50 p-2">
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      >
        <option value="delivered">Delivered</option>
        <option value="out_for_delivery">Out for Delivery</option>
        <option value="in_transit">In Transit</option>
        <option value="accepted">Accepted</option>
        <option value="delivery_exception">Delivery Exception</option>
        <option value="returned">Returned</option>
        <option value="not_delivered">Not Delivered</option>
        <option value="imb_recorded">IMb Recorded</option>
      </select>
      <input
        value={trackingNumber}
        onChange={(event) => setTrackingNumber(event.target.value)}
        placeholder="LetterTrack IMb / tracking reference"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={providerEventId}
        onChange={(event) => setProviderEventId(event.target.value)}
        placeholder="Provider event ID / scan ID (optional)"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={location}
        onChange={(event) => setLocation(event.target.value)}
        placeholder="Location (optional)"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <input
        value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)}
        placeholder="Occurred at ISO/date (optional)"
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Evidence note / copied LetterTrack status"
        rows={2}
        className="w-full rounded border bg-white px-2 py-1 text-xs"
      />
      <button
        onClick={recordEvidence}
        disabled={saving}
        className="rounded bg-green-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
      >
        {saving ? "Recording..." : "Record Delivery Evidence"}
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
