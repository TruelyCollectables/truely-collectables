"use client";

import { useState } from "react";
import type { ReactNode } from "react";

type FeedbackTone = "success" | "error" | "info";

export default function TrackingForm({
  orderId,
  currentCarrier,
  currentTrackingNumber,
  canMarkShipped = true,
  reviewMessage,
  dryRunShippingBlocked = false,
}: {
  orderId: number;
  currentCarrier: string;
  currentTrackingNumber: string;
  canMarkShipped?: boolean;
  reviewMessage?: string;
  dryRunShippingBlocked?: boolean;
}) {
  const [carrier, setCarrier] = useState(currentCarrier || "USPS");
  const [trackingNumber, setTrackingNumber] = useState(
    currentTrackingNumber || ""
  );
  const [saving, setSaving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [message, setMessage] = useState<{
    tone: FeedbackTone;
    text: string;
  } | null>(null);
  const cleanCarrier = carrier.trim();
  const cleanTrackingNumber = trackingNumber.trim();
  const actionsBusy = saving || shipping;
  const trackingBlockedReason = dryRunShippingBlocked
    ? "The active shipping label is a dry-run simulation. Record a real label, tracking, and Coverage policy before using generic tracking actions."
    : !cleanCarrier
      ? "Choose or enter a carrier before saving tracking."
      : !cleanTrackingNumber
        ? "Enter a tracking number before saving or marking shipped."
        : null;
  const trackingDisabledReason = actionsBusy
    ? "Finish the current tracking action first."
    : trackingBlockedReason || "";
  const shipmentDisabledReason = trackingDisabledReason ||
    (!canMarkShipped
      ? reviewMessage ||
        "This order is on a review hold and cannot be marked shipped yet."
      : "");
  const canSubmitTracking = !actionsBusy && !trackingBlockedReason;
  const canSubmitShipment = canSubmitTracking && canMarkShipped;

  async function saveTracking() {
    if (trackingBlockedReason) {
      setMessage(
        { tone: "error", text: trackingBlockedReason },
      );
      return;
    }

    setSaving(true);
    setMessage({ tone: "info", text: "Saving tracking..." });

    try {
      const res = await fetch("/api/orders/update-tracking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          carrier: cleanCarrier,
          trackingNumber: cleanTrackingNumber,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({ tone: "error", text: data.error || "Failed to save tracking." });
        return;
      }

      setMessage({ tone: "success", text: "Tracking saved." });
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Failed to save tracking." });
    } finally {
      setSaving(false);
    }
  }

  async function markShipped() {
    if (trackingBlockedReason) {
      setMessage({ tone: "error", text: trackingBlockedReason });
      return;
    }

    if (!canMarkShipped) {
      setMessage({
        tone: "error",
        text:
          reviewMessage ||
          "This order is on a review hold and cannot be marked shipped yet.",
      });
      return;
    }

    setShipping(true);
    setMessage({ tone: "info", text: "Saving tracking and marking shipped..." });

    try {
      const save = await fetch("/api/orders/update-tracking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          carrier: cleanCarrier,
          trackingNumber: cleanTrackingNumber,
        }),
      });

      const saveData = await save.json().catch(() => ({}));

      if (!save.ok) {
        setMessage({ tone: "error", text: saveData.error || "Unable to save tracking." });
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

      const shipData = await ship.json().catch(() => ({}));

      if (!ship.ok) {
        setMessage({ tone: "error", text: shipData.error || "Unable to mark shipped." });
        return;
      }

      setMessage({ tone: "success", text: "Order marked shipped. Refreshing..." });

      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Unable to mark shipped." });
    } finally {
      setShipping(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-black text-neutral-900">
          Carrier
          <select
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-neutral-950"
          >
            <option>USPS</option>
            <option>UPS</option>
            <option>FedEx</option>
            <option>Canada Post</option>
            <option>Other</option>
          </select>
        </label>

        <label className="block text-sm font-black text-neutral-900">
          Tracking Number
          <input
            className="mt-2 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-neutral-950"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="9405..."
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={saveTracking}
          disabled={!canSubmitTracking}
          aria-busy={saving}
          title={
            trackingDisabledReason ||
            "Save this tracking carrier and tracking number."
          }
          className="rounded-2xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Tracking"}
        </button>

        <button
          type="button"
          onClick={markShipped}
          disabled={!canSubmitShipment}
          aria-busy={shipping}
          title={
            shipping
              ? "Saving tracking and marking shipped..."
              : shipmentDisabledReason || "Save tracking and mark this order shipped."
          }
          className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {shipping ? "Marking shipped..." : "Mark Shipped"}
        </button>
      </div>

      {!canMarkShipped && reviewMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
        >
          {reviewMessage}
        </div>
      ) : null}

      {dryRunShippingBlocked ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-950"
        >
          Dry-run shipping is blocking generic tracking and shipped-status
          actions. Record a real manual label + Coverage policy first.
        </div>
      ) : null}

      {message ? (
        <ActionNotice tone={message.tone}>{message.text}</ActionNotice>
      ) : trackingBlockedReason ? (
        <ActionNotice tone="info">{trackingBlockedReason}</ActionNotice>
      ) : null}
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: FeedbackTone;
  children: ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-2xl border px-3 py-2 text-sm font-bold ${className}`}
    >
      {children}
    </p>
  );
}
