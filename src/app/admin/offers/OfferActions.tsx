"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
  const offerActionRunningRef = useRef(false);
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
  const offerActionBusyReason = isBusy
    ? "Finish the current offer decision before starting another action."
    : "";
  const acceptDisabledReason = canAccept
    ? offerActionBusyReason || "Accept this offer and create a checkout link."
    : `Accept needs: ${acceptRequirements.join(", ")}.`;
  const declineDisabledReason = canDecline
    ? offerActionBusyReason || "Decline this pending offer."
    : `Decline needs: ${declineRequirements.join(", ")}.`;
  const counterDisabledReason = canCounter
    ? offerActionBusyReason || "Send a counter offer checkout link."
    : `Counter needs: ${counterRequirements.join(", ")}.`;
  const counterInputTitle = isBusy
    ? "Finish the current offer decision before editing the counter amount."
    : !isPending
      ? "Counter amount is locked because this offer is no longer pending."
      : productPrice
        ? `Enter a counter above the buyer offer and up to ${money(productPrice)}.`
        : "Enter a counter amount after the product asking price is available.";
  const visibleRequirements = Array.from(
    new Set([...acceptRequirements, ...counterRequirements]),
  );

  async function updateStatus(newStatus: string) {
    if (offerActionRunningRef.current) {
      setMessage({
        tone: "error",
        text: "Finish the current offer decision before starting another action.",
      });
      return;
    }

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

    offerActionRunningRef.current = true;
    setLoading(newStatus);
    setMessage({
      tone: "info",
      text:
        newStatus === "accepted"
          ? "Creating accepted-offer checkout link..."
          : "Declining offer...",
    });

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
        text:
          newStatus === "accepted"
            ? "Offer accepted and checkout link saved."
            : "Offer declined.",
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({ tone: "error", text: "Could not update offer." });
    } finally {
      offerActionRunningRef.current = false;
      setLoading("");
    }
  }

  async function sendCounterOffer() {
    if (offerActionRunningRef.current) {
      setMessage({
        tone: "error",
        text: "Finish the current offer decision before starting another action.",
      });
      return;
    }

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

    offerActionRunningRef.current = true;
    setLoading("counter");
    setMessage({
      tone: "info",
      text: "Creating counter-offer checkout link...",
    });

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
      offerActionRunningRef.current = false;
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
        aria-disabled={!canAccept || isBusy}
        aria-busy={loading === "accepted"}
        aria-label="Accept offer and create checkout link"
        title={acceptDisabledReason}
        onClick={() => updateStatus("accepted")}
        className="w-full rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {loading === "accepted" ? "Creating checkout link..." : "Accept"}
      </button>

      <button
        type="button"
        aria-disabled={!canDecline || isBusy}
        aria-busy={loading === "declined"}
        aria-label="Decline offer"
        title={declineDisabledReason}
        onClick={() => updateStatus("declined")}
        className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {loading === "declined" ? "Declining offer..." : "Decline"}
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
          title={counterInputTitle}
          onChange={(e) => setCounterAmount(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
        />
      </label>

      <button
        type="button"
        aria-disabled={!canCounter || isBusy}
        aria-busy={loading === "counter"}
        aria-label="Send counter offer checkout link"
        title={counterDisabledReason}
        onClick={sendCounterOffer}
        className="w-full rounded-md bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {loading === "counter" ? "Sending counter link..." : "Counter Offer"}
      </button>

      {isPending && visibleRequirements.length > 0 ? (
        <ActionNotice tone="info">
          Some offer actions require: {visibleRequirements.join(", ")}.
        </ActionNotice>
      ) : null}

      {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
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
    <p
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-xl border px-3 py-2 text-xs font-bold ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
