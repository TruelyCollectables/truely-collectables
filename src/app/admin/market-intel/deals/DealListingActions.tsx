"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addAdminHandoff } from "../../../../lib/admin-handoff";

type ActionTone = "success" | "error" | "info";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return Number(value || 0).toFixed(2);
}

function actionTone(message: string): ActionTone {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("could not") ||
    normalized.includes("unable") ||
    normalized.includes("failed") ||
    normalized.includes("required") ||
    normalized.includes("must")
  ) {
    return "error";
  }

  if (
    normalized.includes("ending") ||
    normalized.includes("recording") ||
    normalized.includes("saving")
  ) {
    return "info";
  }

  return "success";
}

function Notice({ message }: { message: string }) {
  const tone = actionTone(message);
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p className={`rounded-2xl border px-3 py-2 text-xs font-black ${className}`}>
      {message}
    </p>
  );
}

export default function DealListingActions({
  listingId,
  title,
  quantity,
  deliveredPrice,
  handoff,
  compact = false,
  dark = false,
  hasExactIdentity = true,
}: {
  listingId: string;
  title: string;
  quantity: number;
  deliveredPrice: number;
  handoff?: string | null;
  compact?: boolean;
  dark?: boolean;
  hasExactIdentity?: boolean;
}) {
  const router = useRouter();
  const [showPurchase, setShowPurchase] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState<"end" | "purchase" | null>(null);
  const [message, setMessage] = useState("");
  const [totalCost, setTotalCost] = useState(money(deliveredPrice));
  const [purchaseQuantity, setPurchaseQuantity] = useState(
    String(Math.max(1, Math.round(Number(quantity || 1)))),
  );
  const [purchaseDate, setPurchaseDate] = useState(todayDate());
  const [alreadyReceived, setAlreadyReceived] = useState(false);

  const endUrl = addAdminHandoff(
    `/api/admin/market-intel/listings/${listingId}/end`,
    handoff,
  );
  const purchaseUrl = addAdminHandoff(
    `/api/admin/market-intel/listings/${listingId}/purchase`,
    handoff,
  );
  const totalCostNumber = Number(totalCost);
  const quantityNumber = Number(purchaseQuantity);
  const purchaseMissing = [
    !hasExactIdentity ? "exact collectible identity" : null,
    !Number.isFinite(totalCostNumber) || totalCostNumber < 0
      ? "valid out-the-door cost"
      : null,
    !Number.isInteger(quantityNumber) || quantityNumber <= 0
      ? "positive whole quantity"
      : null,
    !purchaseDate.trim() ? "purchase date" : null,
  ].filter(Boolean);

  async function endListing() {
    if (!confirmEnd) {
      setConfirmEnd(true);
      setShowPurchase(false);
      setMessage("Confirm end listing before TCOS removes it from the active deal desk.");
      return;
    }

    setBusy("end");
    setMessage("Ending listing...");

    try {
      const response = await fetch(endUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Could not end listing.");
      }

      setMessage(data.message || "Listing ended and removed from the active desk.");
      setConfirmEnd(false);
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Could not end listing.");
    } finally {
      setBusy(null);
    }
  }

  async function recordPurchase() {
    if (purchaseMissing.length > 0) {
      setMessage(`Purchase needs: ${purchaseMissing.join(", ")}.`);
      return;
    }

    setBusy("purchase");
    setMessage("Recording purchase position...");

    try {
      const formData = new FormData();
      formData.set("totalAcquisitionCost", String(totalCostNumber));
      formData.set("quantityPurchased", String(quantityNumber));
      formData.set("purchaseDate", purchaseDate);
      if (alreadyReceived) formData.set("alreadyReceived", "on");

      const response = await fetch(purchaseUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Could not record purchase.");
      }

      setMessage(data.message || "Purchase position recorded.");
      if (data.redirectUrl) {
        window.location.href = String(data.redirectUrl);
        return;
      }
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Could not record purchase.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={
        compact
          ? "min-w-48 space-y-2"
          : dark
            ? "w-full space-y-3 rounded-2xl border border-neutral-700 bg-neutral-950/40 p-3"
            : "w-full space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
      }
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setShowPurchase((current) => !current);
            setConfirmEnd(false);
            setMessage("");
          }}
          disabled={busy !== null || !hasExactIdentity}
          className={
            dark
              ? "rounded-2xl bg-lime-300 px-3 py-2 text-xs font-black text-black hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-50"
              : "rounded-2xl bg-neutral-950 px-3 py-2 text-xs font-black text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {showPurchase ? "Hide Purchase" : "Record Purchase"}
        </button>
        <button
          type="button"
          onClick={() => void endListing()}
          disabled={busy !== null}
          className={
            confirmEnd
              ? "rounded-2xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              : dark
                ? "rounded-2xl border border-neutral-600 px-3 py-2 text-xs font-black text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                : "rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {busy === "end"
            ? "Ending..."
            : confirmEnd
              ? "Confirm End"
              : "End Listing"}
        </button>
        {confirmEnd ? (
          <button
            type="button"
            onClick={() => {
              setConfirmEnd(false);
              setMessage("");
            }}
            disabled={busy !== null}
            className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black text-neutral-950 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {!hasExactIdentity ? (
        <Notice message="Purchase disabled until this listing has an exact collectible identity." />
      ) : null}

      {showPurchase ? (
        <div
          className={
            dark
              ? "space-y-2 rounded-2xl border border-lime-300 bg-lime-50 p-3 text-neutral-950"
              : "space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3"
          }
        >
          <p className="line-clamp-2 text-xs font-black text-neutral-700">
            Record actual purchase for {title}
          </p>
          <label className="block text-xs font-black text-neutral-800">
            Actual total out-the-door cost
            <input
              value={totalCost}
              onChange={(event) => setTotalCost(event.target.value)}
              type="number"
              min="0"
              step="0.01"
              className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
            />
          </label>
          <label className="block text-xs font-black text-neutral-800">
            Quantity purchased
            <input
              value={purchaseQuantity}
              onChange={(event) => setPurchaseQuantity(event.target.value)}
              type="number"
              min="1"
              step="1"
              className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
            />
          </label>
          <label className="block text-xs font-black text-neutral-800">
            Purchase date
            <input
              value={purchaseDate}
              onChange={(event) => setPurchaseDate(event.target.value)}
              type="date"
              className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-neutral-950"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-black text-neutral-800">
            <input
              checked={alreadyReceived}
              onChange={(event) => setAlreadyReceived(event.target.checked)}
              type="checkbox"
            />
            Already received and in inventory
          </label>
          {purchaseMissing.length > 0 ? (
            <Notice message={`Required: ${purchaseMissing.join(", ")}.`} />
          ) : null}
          <button
            type="button"
            onClick={() => void recordPurchase()}
            disabled={busy !== null || purchaseMissing.length > 0}
            className="w-full rounded-2xl bg-amber-700 px-3 py-2 text-xs font-black text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "purchase" ? "Recording..." : "Create Purchase Position"}
          </button>
        </div>
      ) : null}

      {message ? <Notice message={message} /> : null}
    </div>
  );
}
