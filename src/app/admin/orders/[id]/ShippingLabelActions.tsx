"use client";

import { useState } from "react";

export default function ShippingLabelActions({
  orderId,
  activeDryRunLabel = false,
  initialAction = "",
}: {
  orderId: number;
  activeDryRunLabel?: boolean;
  initialAction?: string;
}) {
  const [preparing, setPreparing] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [openingClaim, setOpeningClaim] = useState(false);
  const [message, setMessage] = useState("");
  const [showManualForm, setShowManualForm] = useState(
    initialAction === "manualPurchase",
  );
  const [showVoidForm, setShowVoidForm] = useState(
    initialAction === "recordVoid",
  );
  const [manualForm, setManualForm] = useState({
    provider: "",
    carrier: "USPS",
    trackingNumber: "",
    postageAmount: "",
    providerLabelId: "",
    providerShipmentId: "",
    labelUrl: "",
    labelPdfUrl: "",
    coverageProvider: "Coverage",
    coveragePolicyId: "",
    coverageAmount: "",
    note: "",
  });
  const [voidForm, setVoidForm] = useState({
    provider: "",
    carrier: "USPS",
    trackingNumber: "",
    voidReference: "",
    coverageCancellationReference: "",
    note: "",
  });

  function updateManualForm(field: keyof typeof manualForm, value: string) {
    setManualForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateVoidForm(field: keyof typeof voidForm, value: string) {
    setVoidForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const busy = preparing || purchasing || recording || voiding || openingClaim;
  const providerActionsBlocked = busy || activeDryRunLabel;

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
    if (activeDryRunLabel) {
      setMessage(
        "The active label is a dry-run simulation. Record a real manual label or void this record before trying provider/claim actions.",
      );
      return;
    }

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

  async function openCoverageClaimDraft() {
    if (activeDryRunLabel) {
      setMessage(
        "Dry-run labels do not have real external Coverage policies. Record a real policy before opening a claim.",
      );
      return;
    }

    setOpeningClaim(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/orders/${orderId}/shipping-claims`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not open coverage claim draft.");
        return;
      }

      setMessage(
        data.reused
          ? "Existing open coverage claim draft found."
          : "Coverage claim draft opened. Provider submission still required.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not open coverage claim draft.");
    } finally {
      setOpeningClaim(false);
    }
  }

  async function recordManualPurchase() {
    setRecording(true);
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
            action: "record_manual_purchase",
            ...manualForm,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not record manual label purchase.");
        return;
      }

      setMessage(
        data.message ||
          "Manual shipping label and Coverage policy details were recorded.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not record manual label purchase.");
    } finally {
      setRecording(false);
    }
  }

  async function recordManualVoid() {
    setVoiding(true);
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
            action: "record_manual_void",
            ...voidForm,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(data.error || "Could not record external label void.");
        return;
      }

      setMessage(
        data.message ||
          "External label void/cancel was recorded. You can prepare a replacement label now.",
      );

      setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (error: any) {
      setMessage(error.message || "Could not record external label void.");
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="space-y-3">
      {activeDryRunLabel ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm font-black text-red-950">
          Active label is dry-run only. Record a real external label + Coverage
          policy, or void this dry-run record before claim or provider actions.
        </div>
      ) : null}

      {initialAction === "manualPurchase" ? (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm font-black text-blue-950">
          Dry-run cleanup handoff: save the real external label, tracking/IMb,
          postage, and Coverage policy here before shipping or releasing seller
          funds.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={prepareLabelRecord}
          disabled={busy}
          className="rounded bg-neutral-950 px-4 py-2 font-bold text-white disabled:opacity-50"
        >
          {preparing ? "Preparing..." : "Prepare Label + Coverage Record"}
        </button>

        <button
          onClick={attemptProviderPurchase}
          disabled={providerActionsBlocked}
          className="rounded border border-neutral-950 bg-white px-4 py-2 font-bold text-neutral-950 disabled:opacity-50"
        >
          {purchasing ? "Checking..." : "Attempt Provider Purchase"}
        </button>

        <button
          onClick={() => {
            setShowManualForm((value) => !value);
            setShowVoidForm(false);
          }}
          disabled={busy}
          className="rounded border border-blue-700 bg-blue-50 px-4 py-2 font-bold text-blue-950 disabled:opacity-50"
        >
          {showManualForm ? "Hide Manual Record" : "Record Manual Purchase"}
        </button>

        <button
          onClick={() => {
            setShowVoidForm((value) => !value);
            setShowManualForm(false);
          }}
          disabled={busy}
          className="rounded border border-red-700 bg-red-50 px-4 py-2 font-bold text-red-950 disabled:opacity-50"
        >
          {showVoidForm ? "Hide Void Record" : "Record External Void"}
        </button>

        <button
          onClick={openCoverageClaimDraft}
          disabled={providerActionsBlocked}
          className="rounded border border-amber-700 bg-amber-50 px-4 py-2 font-bold text-amber-950 disabled:opacity-50"
        >
          {openingClaim ? "Opening..." : "Open Coverage Claim Draft"}
        </button>
      </div>

      {showManualForm ? (
        <div className="rounded border bg-gray-50 p-4">
          <div className="mb-3">
            <h3 className="font-black">Manual label + Coverage record</h3>
            <p className="mt-1 text-sm text-gray-600">
              Use this after buying the label or coverage outside TCOS. It
              saves the IDs, tracking, policy, costs, and audit event without
              charging or submitting anything.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField
              label="Label Provider"
              value={manualForm.provider}
              placeholder="USPS, Shippo, EasyPost, manual"
              onChange={(value) => updateManualForm("provider", value)}
            />
            <TextField
              label="Carrier"
              value={manualForm.carrier}
              placeholder="USPS"
              onChange={(value) => updateManualForm("carrier", value)}
            />
            <TextField
              label="Tracking / IMb"
              value={manualForm.trackingNumber}
              placeholder="Tracking number or intelligent mail barcode"
              onChange={(value) => updateManualForm("trackingNumber", value)}
            />
            <TextField
              label="Postage Amount"
              value={manualForm.postageAmount}
              placeholder="1.32"
              onChange={(value) => updateManualForm("postageAmount", value)}
            />
            <TextField
              label="Provider Label ID"
              value={manualForm.providerLabelId}
              placeholder="External label id"
              onChange={(value) => updateManualForm("providerLabelId", value)}
            />
            <TextField
              label="Provider Shipment ID"
              value={manualForm.providerShipmentId}
              placeholder="External shipment id"
              onChange={(value) => updateManualForm("providerShipmentId", value)}
            />
            <TextField
              label="Label URL"
              value={manualForm.labelUrl}
              placeholder="Optional label URL"
              onChange={(value) => updateManualForm("labelUrl", value)}
            />
            <TextField
              label="Label PDF URL"
              value={manualForm.labelPdfUrl}
              placeholder="Optional PDF URL"
              onChange={(value) => updateManualForm("labelPdfUrl", value)}
            />
            <TextField
              label="Coverage Provider"
              value={manualForm.coverageProvider}
              placeholder="Coverage"
              onChange={(value) => updateManualForm("coverageProvider", value)}
            />
            <TextField
              label="Coverage Policy ID"
              value={manualForm.coveragePolicyId}
              placeholder="External policy id"
              onChange={(value) => updateManualForm("coveragePolicyId", value)}
            />
            <TextField
              label="Coverage Amount"
              value={manualForm.coverageAmount}
              placeholder="20.00"
              onChange={(value) => updateManualForm("coverageAmount", value)}
            />
            <label className="block">
              <span className="text-sm font-bold text-gray-700">Note</span>
              <textarea
                value={manualForm.note}
                onChange={(event) => updateManualForm("note", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded border bg-white px-3 py-2"
                placeholder="Where it was purchased, receipt reference, or anything support should know."
              />
            </label>
          </div>

          <button
            onClick={recordManualPurchase}
            disabled={recording}
            className="mt-4 rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50"
          >
            {recording ? "Recording..." : "Save Manual Label + Coverage"}
          </button>
        </div>
      ) : null}

      {showVoidForm ? (
        <div className="rounded border border-red-200 bg-red-50 p-4">
          <div className="mb-3">
            <h3 className="font-black text-red-950">Record external void/cancel</h3>
            <p className="mt-1 text-sm text-red-900">
              Use this only after the label or Coverage policy was voided or
              cancelled outside TCOS. This closes the TCOS label record and logs
              the proof; it does not contact a provider.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField
              label="Provider"
              value={voidForm.provider}
              placeholder="USPS, Shippo, EasyPost, Coverage"
              onChange={(value) => updateVoidForm("provider", value)}
            />
            <TextField
              label="Carrier"
              value={voidForm.carrier}
              placeholder="USPS"
              onChange={(value) => updateVoidForm("carrier", value)}
            />
            <TextField
              label="Tracking / IMb"
              value={voidForm.trackingNumber}
              placeholder="Tracking number or barcode being voided"
              onChange={(value) => updateVoidForm("trackingNumber", value)}
            />
            <TextField
              label="Void Reference"
              value={voidForm.voidReference}
              placeholder="Provider void confirmation / receipt"
              onChange={(value) => updateVoidForm("voidReference", value)}
            />
            <TextField
              label="Coverage Cancel Reference"
              value={voidForm.coverageCancellationReference}
              placeholder="Coverage cancellation id, if any"
              onChange={(value) =>
                updateVoidForm("coverageCancellationReference", value)
              }
            />
            <label className="block">
              <span className="text-sm font-bold text-red-950">Note</span>
              <textarea
                value={voidForm.note}
                onChange={(event) => updateVoidForm("note", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded border bg-white px-3 py-2"
                placeholder="Why it was voided, who voided it, and where the external confirmation lives."
              />
            </label>
          </div>

          <button
            onClick={recordManualVoid}
            disabled={voiding}
            className="mt-4 rounded bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50"
          >
            {voiding ? "Recording..." : "Save External Void"}
          </button>
        </div>
      ) : null}

      {message ? (
        <div className="rounded border bg-gray-50 p-3 text-sm font-semibold">
          {message}
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded border bg-white px-3 py-2"
      />
    </label>
  );
}
