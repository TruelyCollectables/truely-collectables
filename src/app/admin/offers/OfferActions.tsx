"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OfferActions({
  offerId,
  status,
  checkoutUrl,
}: {
  offerId: string;
  status: string;
  checkoutUrl?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState("");
  const [counterAmount, setCounterAmount] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function updateStatus(newStatus: string) {
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

      const data = await res.json();

      if (!res.ok) {
        setMessage({ tone: "error", text: data.error || "Could not update offer." });
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
    if (!counterAmount) {
      setMessage({ tone: "error", text: "Enter a counter amount." });
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
          counterAmount: Number(counterAmount),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ tone: "error", text: data.error || "Could not send counter offer." });
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
    <div className="space-y-2">
      <button
        type="button"
        disabled={status !== "pending" || loading !== ""}
        onClick={() => updateStatus("accepted")}
        className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
      >
        {loading === "accepted" ? "Accepting..." : "Accept"}
      </button>

      <button
        type="button"
        disabled={status !== "pending" || loading !== ""}
        onClick={() => updateStatus("declined")}
        className="w-full border rounded py-2 disabled:opacity-50"
      >
        {loading === "declined" ? "Declining..." : "Decline"}
      </button>

      {checkoutUrl && (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center border rounded py-2 hover:bg-gray-100"
        >
          View Payment Link
        </a>
      )}

      <input
        type="number"
        step="0.01"
        placeholder="Counter amount"
        value={counterAmount}
        onChange={(e) => setCounterAmount(e.target.value)}
        className="w-full border rounded px-3 py-2"
      />

      <button
        type="button"
        disabled={status !== "pending" || loading !== ""}
        onClick={sendCounterOffer}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50"
      >
        {loading === "counter" ? "Sending..." : "Counter Offer"}
      </button>

      {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
    </div>
  );
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
    <p className={`rounded border px-3 py-2 text-xs font-bold ${className}`}>
      {children}
    </p>
  );
}
