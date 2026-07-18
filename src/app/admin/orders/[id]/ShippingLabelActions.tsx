"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";

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
  const shippingActionRunningRef = useRef(false);
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

  function trimRecord<T extends Record<string, string>>(record: T): T {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, value.trim()]),
    ) as T;
  }

  function noticeTone(messageText: string): "success" | "error" | "info" {
    const normalized = messageText.toLowerCase();

    if (
      normalized.includes("could not") ||
      normalized.includes("failed") ||
      normalized.includes("blocked") ||
      normalized.includes("needs:") ||
      normalized.includes("required")
    ) {
      return "error";
    }

    if (
      normalized.includes("preparing") ||
      normalized.includes("checking") ||
      normalized.includes("opening") ||
      normalized.includes("recording")
    ) {
      return "info";
    }

    return "success";
  }

  const busy = preparing || purchasing || recording || voiding || openingClaim;
  const providerActionsBlocked = busy || activeDryRunLabel;
  const manualPurchaseMissing = [
    !manualForm.provider.trim() ? "label provider" : null,
    !manualForm.carrier.trim() ? "carrier" : null,
    !manualForm.trackingNumber.trim() ? "tracking / IMb" : null,
    !manualForm.postageAmount.trim() ? "postage amount" : null,
    manualForm.note.trim().length < 8 ? "audit note" : null,
  ].filter(Boolean);
  const voidMissing = [
    !voidForm.provider.trim() ? "provider" : null,
    !voidForm.carrier.trim() ? "carrier" : null,
    !voidForm.trackingNumber.trim() ? "tracking / IMb" : null,
    !voidForm.voidReference.trim() ? "void reference" : null,
    voidForm.note.trim().length < 8 ? "audit note" : null,
  ].filter(Boolean);

  function shippingActionBlockedReason(action: string) {
    return shippingActionRunningRef.current || busy
      ? `Finish the current shipping label action before ${action}.`
      : "";
  }

  function showShippingActionBlocked(action: string) {
    const blockedReason = shippingActionBlockedReason(action);

    if (!blockedReason) return false;

    setMessage(blockedReason);
    return true;
  }

  function shippingLabelActionTitle({
    action,
    blocked,
    ready,
  }: {
    action: string;
    blocked?: string;
    ready: string;
  }) {
    return busy
      ? `Finish the current shipping label action before ${action}.`
      : blocked || ready;
  }

  async function prepareLabelRecord() {
    if (showShippingActionBlocked("preparing another label record")) return;

    shippingActionRunningRef.current = true;
    setPreparing(true);
    setMessage("Preparing label + Coverage record...");

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
      shippingActionRunningRef.current = false;
      setPreparing(false);
    }
  }

  async function attemptProviderPurchase() {
    if (showShippingActionBlocked("attempting provider purchase")) return;

    if (activeDryRunLabel) {
      setMessage(
        "The active label is a dry-run simulation. Record a real manual label or void this record before trying provider/claim actions.",
      );
      return;
    }

    shippingActionRunningRef.current = true;
    setPurchasing(true);
    setMessage("Checking provider purchase readiness...");

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
      shippingActionRunningRef.current = false;
      setPurchasing(false);
    }
  }

  async function openCoverageClaimDraft() {
    if (showShippingActionBlocked("opening a Coverage claim draft")) return;

    if (activeDryRunLabel) {
      setMessage(
        "Dry-run labels do not have real external Coverage policies. Record a real policy before opening a claim.",
      );
      return;
    }

    shippingActionRunningRef.current = true;
    setOpeningClaim(true);
    setMessage("Opening Coverage claim draft...");

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
      shippingActionRunningRef.current = false;
      setOpeningClaim(false);
    }
  }

  async function recordManualPurchase() {
    if (showShippingActionBlocked("recording manual label purchase")) return;

    if (manualPurchaseMissing.length > 0) {
      setMessage(
        `Manual purchase needs: ${manualPurchaseMissing.join(", ")}.`,
      );
      return;
    }

    shippingActionRunningRef.current = true;
    setRecording(true);
    setMessage("Recording manual label purchase...");

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
            ...trimRecord(manualForm),
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
      shippingActionRunningRef.current = false;
      setRecording(false);
    }
  }

  async function recordManualVoid() {
    if (showShippingActionBlocked("recording an external label void")) return;

    if (voidMissing.length > 0) {
      setMessage(`External void needs: ${voidMissing.join(", ")}.`);
      return;
    }

    shippingActionRunningRef.current = true;
    setVoiding(true);
    setMessage("Recording external label void...");

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
            ...trimRecord(voidForm),
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
      shippingActionRunningRef.current = false;
      setVoiding(false);
    }
  }

  return (
    <div className="space-y-4">
      {activeDryRunLabel ? (
        <ActionNotice tone="error">
          Active label is dry-run only. Record a real external label + Coverage
          policy, or void this dry-run record before claim or provider actions.
        </ActionNotice>
      ) : null}

      {initialAction === "manualPurchase" ? (
        <ActionNotice tone="info">
          Dry-run cleanup handoff: save the real external label, tracking/IMb,
          postage, and Coverage policy here before shipping or releasing seller
          funds.
        </ActionNotice>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={prepareLabelRecord}
          aria-disabled={busy}
          aria-busy={preparing}
          title={shippingLabelActionTitle({
            action: "preparing another label record",
            ready:
              "Prepare an internal shipping label and Coverage record for this order.",
          })}
          className={`rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-black text-white shadow-sm ${
            busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {preparing ? "Preparing label record..." : "Prepare Label + Coverage Record"}
        </button>

        <button
          type="button"
          onClick={attemptProviderPurchase}
          aria-disabled={providerActionsBlocked}
          aria-busy={purchasing}
          title={shippingLabelActionTitle({
            action: "attempting provider purchase",
            blocked: activeDryRunLabel
              ? "Record a real manual label or void the dry-run label before provider purchase."
              : "",
            ready:
              "Check whether live provider credentials and label purchase setup are ready.",
          })}
          className={`rounded-2xl border border-neutral-950 bg-white px-4 py-3 text-sm font-black text-neutral-950 shadow-sm ${
            providerActionsBlocked ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {purchasing ? "Checking provider readiness..." : "Attempt Provider Purchase"}
        </button>

        <button
          type="button"
          onClick={() => {
            if (showShippingActionBlocked("opening the manual purchase form")) return;
            setShowManualForm((value) => !value);
            setShowVoidForm(false);
          }}
          aria-disabled={busy}
          title={shippingLabelActionTitle({
            action: "opening the manual purchase form",
            ready:
              "Open the manual label and Coverage proof form for externally purchased shipping.",
          })}
          className={`rounded-2xl border border-blue-700 bg-blue-50 px-4 py-3 text-sm font-black text-blue-950 shadow-sm ${
            busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {showManualForm ? "Hide Manual Record" : "Record Manual Purchase"}
        </button>

        <button
          type="button"
          onClick={() => {
            if (showShippingActionBlocked("opening the external void form")) return;
            setShowVoidForm((value) => !value);
            setShowManualForm(false);
          }}
          aria-disabled={busy}
          title={shippingLabelActionTitle({
            action: "opening the external void form",
            ready:
              "Open the external void/cancel proof form for a label handled outside TCOS.",
          })}
          className={`rounded-2xl border border-red-700 bg-red-50 px-4 py-3 text-sm font-black text-red-950 shadow-sm ${
            busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {showVoidForm ? "Hide Void Record" : "Record External Void"}
        </button>

        <button
          type="button"
          onClick={openCoverageClaimDraft}
          aria-disabled={providerActionsBlocked}
          aria-busy={openingClaim}
          title={shippingLabelActionTitle({
            action: "opening a Coverage claim draft",
            blocked: activeDryRunLabel
              ? "Record a real Coverage policy before opening a claim."
              : "",
            ready:
              "Open or reuse a Coverage claim draft for this order's shipping label.",
          })}
          className={`rounded-2xl border border-amber-700 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950 shadow-sm ${
            providerActionsBlocked ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {openingClaim ? "Opening Coverage claim..." : "Open Coverage Claim Draft"}
        </button>
      </div>

      {showManualForm ? (
        <div className="rounded-[2rem] border border-blue-200 bg-blue-50 p-4 text-blue-950 shadow-sm">
          <div className="mb-3">
            <h3 className="font-black">Manual label + Coverage record</h3>
            <p className="mt-1 text-sm font-semibold leading-6 opacity-80">
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
              <span className="text-sm font-black">Audit note</span>
              <textarea
                value={manualForm.note}
                onChange={(event) => updateManualForm("note", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-2xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-800"
                placeholder="Where it was purchased, receipt reference, or anything support should know."
              />
            </label>
          </div>

          {manualPurchaseMissing.length > 0 ? (
            <ActionNotice tone="info">
              Required before saving: {manualPurchaseMissing.join(", ")}.
            </ActionNotice>
          ) : null}

          <button
            type="button"
            onClick={recordManualPurchase}
            aria-disabled={busy || manualPurchaseMissing.length > 0}
            aria-busy={recording}
            title={shippingLabelActionTitle({
              action: "recording manual label purchase",
              blocked: manualPurchaseMissing.length
                ? `Required: ${manualPurchaseMissing.join(", ")}.`
                : "",
              ready:
                "Save the external label, tracking, postage, and Coverage proof for this order.",
            })}
            className={`mt-4 rounded-2xl bg-blue-800 px-4 py-3 text-sm font-black text-white shadow-sm ${
              busy || manualPurchaseMissing.length > 0
                ? "cursor-not-allowed opacity-50"
                : ""
            }`}
          >
            {recording
              ? "Recording manual label + Coverage..."
              : "Save Manual Label + Coverage"}
          </button>
        </div>
      ) : null}

      {showVoidForm ? (
        <div className="rounded-[2rem] border border-red-200 bg-red-50 p-4 text-red-950 shadow-sm">
          <div className="mb-3">
            <h3 className="font-black">Record external void/cancel</h3>
            <p className="mt-1 text-sm font-semibold leading-6 opacity-80">
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
              <span className="text-sm font-black">Audit note</span>
              <textarea
                value={voidForm.note}
                onChange={(event) => updateVoidForm("note", event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-2xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-red-800"
                placeholder="Why it was voided, who voided it, and where the external confirmation lives."
              />
            </label>
          </div>

          {voidMissing.length > 0 ? (
            <ActionNotice tone="info">
              Required before saving: {voidMissing.join(", ")}.
            </ActionNotice>
          ) : null}

          <button
            type="button"
            onClick={recordManualVoid}
            aria-disabled={busy || voidMissing.length > 0}
            aria-busy={voiding}
            title={shippingLabelActionTitle({
              action: "recording an external label void",
              blocked: voidMissing.length
                ? `Required: ${voidMissing.join(", ")}.`
                : "",
              ready:
                "Save the external label void/cancel proof and close the TCOS label record.",
            })}
            className={`mt-4 rounded-2xl bg-red-800 px-4 py-3 text-sm font-black text-white shadow-sm ${
              busy || voidMissing.length > 0
                ? "cursor-not-allowed opacity-50"
                : ""
            }`}
          >
            {voiding ? "Recording external label void..." : "Save External Void"}
          </button>
        </div>
      ) : null}

      {message ? (
        <ActionNotice tone={noticeTone(message)}>
          {message}
        </ActionNotice>
      ) : null}
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
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
      className={`rounded-2xl border px-3 py-2 text-sm font-black ${className}`}
    >
      {children}
    </p>
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
      <span className="text-sm font-black">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-2xl border border-current/20 bg-white px-3 py-2 text-sm font-semibold text-neutral-950 outline-none focus:border-neutral-950"
      />
    </label>
  );
}
