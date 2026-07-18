"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  adminOfferDecisionError,
  adminOfferDecisionRequirements,
} from "../../../lib/admin-offer-decision";

export default function OfferActions({
  offerId,
  status,
  checkoutUrl,
  offerAmount,
  productPrice,
  productQuantity,
}: {
  offerId: string;
  status: string;
  checkoutUrl?: string | null;
  offerAmount: number;
  productPrice?: number | null;
  productQuantity?: number | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [counterAmount, setCounterAmount] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const isPending = status === "pending";
  const isBusy = loading !== "";
  const acceptRequirements = adminOfferDecisionRequirements({
    action: "accepted",
    offerStatus: status,
    offerAmount,
    productPrice,
    productQuantity,
  });
  const declineRequirements = adminOfferDecisionRequirements({
    action: "declined",
    offerStatus: status,
    offerAmount,
    productPrice,
    productQuantity,
  });
  const counterRequirements = adminOfferDecisionRequirements({
    action: "countered",
    offerStatus: status,
    offerAmount,
    counterAmount,
    productPrice,
    productQuantity,
  });
  const canAccept = acceptRequirements.length === 0;
  const canDecline = declineRequirements.length === 0;
  const canCounter = counterRequirements.length === 0;
  const visibleRequirements = Array.from(
    new Set([...acceptRequirements, ...counterRequirements]),
  );

  async function updateStatus(newStatus: string) {
    const action = newStatus === "declined" ? "declined" : "accepted";
    const blocked = adminOfferDecisionError({
      action,
      offerStatus: status,
      offerAmount,
      productPrice,
      productQuantity,
    });

    if (blocked) {
      setMessage({
        tone: "error",
        text: blocked,
      });
      return;
    }

    setLoading(newStatus);
    setMessage({ tone: "info", text: `Saving offer as ${newStatus}...` });

    try {
      const res = await fetch("/api/offers/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offerId,
          status: newStatus,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Could not update offer.",
        });
        return;
      }

      setMessage({
        tone: "success",
        text: `Offer ${newStatus}.`,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({ tone: "error", text: "Could not update offer." });
    } finally {
      setLoading("");
    }
  }

  async function sendCounterOffer() {
    const blocked = adminOfferDecisionError({
      action: "countered",
      offerStatus: status,
      offerAmount,
      counterAmount,
      productPrice,
      productQuantity,
    });

    if (blocked) {
      setMessage({
        tone: "error",
        text: blocked,
      });
      return;
    }

    const parsedCounterAmount = Number(counterAmount);

    if (!Number.isFinite(parsedCounterAmount) || parsedCounterAmount <= 0) {
      setMessage({
        tone: "error",
        text: "Enter a counter amount greater than $0.00.",
      });
      return;
    }

    setLoading("counter");
    setMessage({ tone: "info", text: "Sending counter offer..." });

    try {
      const res = await fetch("/api/offers/counter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offerId,
          counterAmount: parsedCounterAmount,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Could not send counter offer.",
        });
        return;
      }

      setMessage({ tone: "success", text: "Counter offer sent." });
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({ tone: "error", text: "Could not send counter offer." });
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
          Decision
        </p>
        <p className="mt-1 text-sm font-semibold text-neutral-600">
          {isPending
            ? "Choose an offer outcome. Accepted and countered offers create Stripe payment links."
            : "This offer is no longer pending, so decision controls are locked."}
        </p>
      </div>

      <button
        type="button"
        disabled={!canAccept || isBusy}
        onClick={() => updateStatus("accepted")}
        className="w-full rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading === "accepted" ? "Accepting..." : "Accept"}
      </button>

      <button
        type="button"
        disabled={!canDecline || isBusy}
        onClick={() => updateStatus("declined")}
        className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading === "declined" ? "Declining..." : "Decline"}
      </button>

      {checkoutUrl && (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-center text-sm font-black text-emerald-950 hover:bg-emerald-100"
        >
          View Payment Link
        </a>
      )}

      <label className="block">
        <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
          Counter amount
        </span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          placeholder={
            productPrice ? `Above offer, up to ${money(productPrice)}` : "0.00"
          }
          value={counterAmount}
          disabled={!isPending || isBusy}
          onChange={(e) => setCounterAmount(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
        />
      </label>

      <button
        type="button"
        disabled={!canCounter || isBusy}
        onClick={sendCounterOffer}
        className="w-full rounded-md bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading === "counter" ? "Sending..." : "Counter Offer"}
      </button>

      {isPending && visibleRequirements.length > 0 ? (
        <ActionNotice tone="info">
          Some offer actions require: {visibleRequirements.join(", ")}.
        </ActionNotice>
      ) : null}

      {message ? (
        <ActionNotice tone={message.tone}>{message.text}</ActionNotice>
      ) : null}
    </div>
  );
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function ActionNotice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p className={`rounded-xl border px-3 py-2 text-xs font-bold ${className}`}>
      {children}
    </p>
  );
}
