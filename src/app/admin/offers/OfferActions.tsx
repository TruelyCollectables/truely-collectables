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

  async function updateStatus(newStatus: string) {
    setLoading(newStatus);

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
        alert(data.error || "Failed");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Failed");
    } finally {
      setLoading("");
    }
  }

  async function sendCounterOffer() {
    if (!counterAmount) {
      alert("Enter a counter amount");
      return;
    }

    setLoading("counter");

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
        alert(data.error || "Failed");
        return;
      }

      alert("Counter offer sent");
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Failed");
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="space-y-2">
      <button
        disabled={status !== "pending" || loading !== ""}
        onClick={() => updateStatus("accepted")}
        className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
      >
        {loading === "accepted" ? "Accepting..." : "Accept"}
      </button>

      <button
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
        disabled={status !== "pending" || loading !== ""}
        onClick={sendCounterOffer}
        className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50"
      >
        {loading === "counter" ? "Sending..." : "Counter Offer"}
      </button>
    </div>
  );
}