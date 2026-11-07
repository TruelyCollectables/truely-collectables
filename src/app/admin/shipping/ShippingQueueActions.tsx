"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";

type NoticeTone = "success" | "error" | "info";

function noticeTone(message: string): NoticeTone {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("could not") ||
    normalized.includes("failed") ||
    normalized.includes("required") ||
    normalized.includes("needs")
  ) {
    return "error";
  }

  if (
    normalized.includes("saving") ||
    normalized.includes("recording") ||
    normalized.includes("marking") ||
    normalized.includes("finish")
  ) {
    return "info";
  }

  return "success";
}

function ActionNotice({
  tone,
  children,
}: {
  tone: NoticeTone;
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
      className={`rounded-2xl border px-3 py-2 text-xs font-black ${className}`}
    >
      {children}
    </p>
  );
}

function shippingQueueActionTitle({
  busy,
  ready,
  requiredMissing,
}: {
  busy: boolean;
  ready: string;
  requiredMissing: readonly (string | null | undefined)[];
}) {
  if (busy) return "Finish the current shipping queue action first.";

  const missing = requiredMissing.filter((value): value is string =>
    Boolean(value),
  );

  if (missing.length > 0) {
    return `Required: ${missing.join(", ")}.`;
  }

  return ready;
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const className =
    "mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950";

  return (
    <label className="block text-xs font-black text-neutral-800">
      {label}
      {rows ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={className}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  );
}

export function SaveCoveragePolicyForm({
  labelId,
  defaultProvider = "Coverage",
  defaultAmount = "",
}: {
  labelId: string;
  defaultProvider?: string;
  defaultAmount?: string;
}) {
  const shippingQueueActionRef = useRef(false);
  const [coverageProvider, setCoverageProvider] = useState(
    defaultProvider || "Coverage",
  );
  const [coveragePolicyId, setCoveragePolicyId] = useState("");
  const [coverageAmount, setCoverageAmount] = useState(defaultAmount);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requiredMissing = [
    !coverageProvider.trim() ? "coverage provider" : null,
    !coveragePolicyId.trim() ? "coverage policy ID" : null,
    !coverageAmount.trim() ? "coverage amount" : null,
    note.trim().length < 8 ? "audit note" : null,
  ].filter(Boolean);

  async function savePolicy() {
    if (shippingQueueActionRef.current || saving) {
      setMessage("Finish the current shipping queue action first.");
      return;
    }

    if (requiredMissing.length > 0) {
      setMessage(`Coverage policy needs: ${requiredMissing.join(", ")}.`);
      return;
    }

    shippingQueueActionRef.current = true;
    setSaving(true);
    setMessage("Saving Coverage policy...");

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
      shippingQueueActionRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <TextField
        label="Coverage provider"
        value={coverageProvider}
        onChange={setCoverageProvider}
        placeholder="Coverage provider"
      />
      <TextField
        label="Coverage policy ID"
        value={coveragePolicyId}
        onChange={setCoveragePolicyId}
        placeholder="Coverage policy ID"
      />
      <TextField
        label="Coverage amount"
        value={coverageAmount}
        onChange={setCoverageAmount}
        placeholder="Coverage amount"
      />
      <TextField
        label="Audit note"
        value={note}
        onChange={setNote}
        placeholder="External receipt, policy proof, or operator note"
        rows={2}
      />
      <button
        type="button"
        onClick={savePolicy}
        aria-disabled={saving || requiredMissing.length > 0}
        aria-busy={saving}
        title={shippingQueueActionTitle({
          busy: saving,
          requiredMissing,
          ready: "Save Coverage policy proof for this shipping label.",
        })}
        className="rounded-2xl bg-amber-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {saving ? "Saving Coverage policy..." : "Save Coverage Policy"}
      </button>
      {message ? (
        <ActionNotice tone={noticeTone(message)}>{message}</ActionNotice>
      ) : requiredMissing.length > 0 ? (
        <ActionNotice tone="info">
          Required: {requiredMissing.join(", ")}.
        </ActionNotice>
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
  const shippingQueueActionRef = useRef(false);
  const [carrier, setCarrier] = useState(defaultCarrier || "USPS");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requiredMissing = [
    !carrier.trim() ? "carrier" : null,
    !trackingNumber.trim() ? "tracking number or IMb" : null,
  ].filter(Boolean);

  async function saveTracking() {
    if (shippingQueueActionRef.current || saving) {
      setMessage("Finish the current shipping queue action first.");
      return;
    }

    if (requiredMissing.length > 0) {
      setMessage(`Tracking needs: ${requiredMissing.join(", ")}.`);
      return;
    }

    shippingQueueActionRef.current = true;
    setSaving(true);
    setMessage("Saving tracking...");

    try {
      const response = await fetch("/api/orders/update-tracking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          carrier: carrier.trim(),
          trackingNumber: trackingNumber.trim(),
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
      shippingQueueActionRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-3">
      <div className="grid grid-cols-1 gap-2">
        <TextField
          label="Carrier"
          value={carrier}
          onChange={setCarrier}
          placeholder="Carrier"
        />
        <TextField
          label="Tracking / IMb"
          value={trackingNumber}
          onChange={setTrackingNumber}
          placeholder="Tracking number or IMb"
        />
      </div>
      <button
        type="button"
        onClick={saveTracking}
        aria-disabled={saving || requiredMissing.length > 0}
        aria-busy={saving}
        title={shippingQueueActionTitle({
          busy: saving,
          requiredMissing,
          ready: "Save the carrier and tracking number for this order.",
        })}
        className="rounded-2xl bg-blue-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {saving ? "Saving tracking..." : "Save Tracking"}
      </button>
      {message ? (
        <ActionNotice tone={noticeTone(message)}>{message}</ActionNotice>
      ) : requiredMissing.length > 0 ? (
        <ActionNotice tone="info">
          Required: {requiredMissing.join(", ")}.
        </ActionNotice>
      ) : null}
    </div>
  );
}

export function RecordLetterTrackImbForm({
  orderId,
}: {
  orderId: number;
}) {
  const shippingQueueActionRef = useRef(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [letterTrackReference, setLetterTrackReference] = useState("");
  const [postageAmount, setPostageAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requiredMissing = [
    !trackingNumber.trim() ? "LetterTrack IMb / tracking reference" : null,
    note.trim().length < 8 ? "audit note" : null,
  ].filter(Boolean);

  async function recordImb() {
    if (shippingQueueActionRef.current || saving) {
      setMessage("Finish the current shipping queue action first.");
      return;
    }

    if (requiredMissing.length > 0) {
      setMessage(`LetterTrack IMb needs: ${requiredMissing.join(", ")}.`);
      return;
    }

    shippingQueueActionRef.current = true;
    setSaving(true);
    setMessage("Recording LetterTrack IMb...");

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
            trackingNumber: trackingNumber.trim(),
            letterTrackReference: letterTrackReference.trim(),
            postageAmount: postageAmount.trim(),
            note: note.trim(),
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
      shippingQueueActionRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-3">
      <TextField
        label="LetterTrack IMb / tracking"
        value={trackingNumber}
        onChange={setTrackingNumber}
        placeholder="LetterTrack IMb / tracking reference"
      />
      <TextField
        label="LetterTrack reference"
        value={letterTrackReference}
        onChange={setLetterTrackReference}
        placeholder="LetterTrack order/mailpiece ID (optional)"
      />
      <TextField
        label="Postage amount"
        value={postageAmount}
        onChange={setPostageAmount}
        placeholder="Postage amount (optional)"
      />
      <TextField
        label="Audit note"
        value={note}
        onChange={setNote}
        placeholder="Internal note"
        rows={2}
      />
      <button
        type="button"
        onClick={recordImb}
        aria-disabled={saving || requiredMissing.length > 0}
        aria-busy={saving}
        title={shippingQueueActionTitle({
          busy: saving,
          requiredMissing,
          ready: "Record the LetterTrack IMb or tracking reference for this order.",
        })}
        className="rounded-2xl bg-blue-950 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {saving ? "Recording LetterTrack IMb..." : "Record LetterTrack IMb"}
      </button>
      {message ? (
        <ActionNotice tone={noticeTone(message)}>{message}</ActionNotice>
      ) : requiredMissing.length > 0 ? (
        <ActionNotice tone="info">
          Required: {requiredMissing.join(", ")}.
        </ActionNotice>
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
  const shippingQueueActionRef = useRef(false);
  const [status, setStatus] = useState("delivered");
  const [trackingNumber, setTrackingNumber] = useState(defaultTrackingNumber);
  const [providerEventId, setProviderEventId] = useState("");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const requiredMissing = [
    !status.trim() ? "status" : null,
    !trackingNumber.trim() ? "LetterTrack IMb / tracking reference" : null,
    note.trim().length < 8 ? "evidence note" : null,
  ].filter(Boolean);

  async function recordEvidence() {
    if (shippingQueueActionRef.current || saving) {
      setMessage("Finish the current shipping queue action first.");
      return;
    }

    if (requiredMissing.length > 0) {
      setMessage(`Delivery evidence needs: ${requiredMissing.join(", ")}.`);
      return;
    }

    shippingQueueActionRef.current = true;
    setSaving(true);
    setMessage("Recording delivery evidence...");

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
            trackingNumber: trackingNumber.trim(),
            providerEventId: providerEventId.trim(),
            location: location.trim(),
            occurredAt: occurredAt.trim(),
            note: note.trim(),
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
      shippingQueueActionRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-3">
      <label className="block text-xs font-black text-neutral-800">
        Delivery status
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
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
      </label>
      <TextField
        label="LetterTrack IMb / tracking"
        value={trackingNumber}
        onChange={setTrackingNumber}
        placeholder="LetterTrack IMb / tracking reference"
      />
      <TextField
        label="Provider event ID"
        value={providerEventId}
        onChange={setProviderEventId}
        placeholder="Provider event ID / scan ID (optional)"
      />
      <TextField
        label="Location"
        value={location}
        onChange={setLocation}
        placeholder="Location (optional)"
      />
      <TextField
        label="Occurred at"
        value={occurredAt}
        onChange={setOccurredAt}
        placeholder="Occurred at ISO/date (optional)"
      />
      <TextField
        label="Evidence note"
        value={note}
        onChange={setNote}
        placeholder="Evidence note / copied LetterTrack status"
        rows={2}
      />
      <button
        type="button"
        onClick={recordEvidence}
        aria-disabled={saving || requiredMissing.length > 0}
        aria-busy={saving}
        title={shippingQueueActionTitle({
          busy: saving,
          requiredMissing,
          ready: "Record delivery evidence copied from LetterTrack or the carrier.",
        })}
        className="rounded-2xl bg-green-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {saving ? "Recording delivery evidence..." : "Record Delivery Evidence"}
      </button>
      {message ? (
        <ActionNotice tone={noticeTone(message)}>{message}</ActionNotice>
      ) : requiredMissing.length > 0 ? (
        <ActionNotice tone="info">
          Required: {requiredMissing.join(", ")}.
        </ActionNotice>
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
  const shippingQueueActionRef = useRef(false);
  const [shipping, setShipping] = useState(false);
  const [message, setMessage] = useState("");
  const requiredMissing = [
    !carrier.trim() ? "carrier" : null,
    !trackingNumber.trim() ? "tracking number or IMb" : null,
  ].filter(Boolean);

  async function markShipped() {
    if (shippingQueueActionRef.current || shipping) {
      setMessage("Finish the current shipping queue action first.");
      return;
    }

    if (requiredMissing.length > 0) {
      setMessage(`Mark shipped needs: ${requiredMissing.join(", ")}.`);
      return;
    }

    shippingQueueActionRef.current = true;
    setShipping(true);
    setMessage("Marking order shipped...");

    try {
      const trackingResponse = await fetch("/api/orders/update-tracking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          carrier: carrier.trim(),
          trackingNumber: trackingNumber.trim(),
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
      shippingQueueActionRef.current = false;
      setShipping(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
      <button
        type="button"
        onClick={markShipped}
        aria-disabled={shipping || requiredMissing.length > 0}
        aria-busy={shipping}
        title={shippingQueueActionTitle({
          busy: shipping,
          requiredMissing,
          ready: "Save tracking and mark this order shipped.",
        })}
        className="rounded-2xl bg-emerald-800 px-3 py-2 text-xs font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {shipping ? "Marking order shipped..." : "Mark Shipped"}
      </button>
      {message ? (
        <ActionNotice tone={noticeTone(message)}>{message}</ActionNotice>
      ) : requiredMissing.length > 0 ? (
        <ActionNotice tone="info">
          Required: {requiredMissing.join(", ")}.
        </ActionNotice>
      ) : null}
    </div>
  );
}
