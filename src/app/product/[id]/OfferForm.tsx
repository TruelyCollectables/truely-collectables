"use client";

import { useState } from "react";

export default function OfferForm({
  productId,
  price,
}: {
  productId: number;
  price: number;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  async function submitOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = e.currentTarget;
    const formData = new FormData(form);

    const res = await fetch("/api/offers/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId,
        name: formData.get("name"),
        email: formData.get("email"),
        offerAmount: Number(formData.get("offerAmount")),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Something went wrong.");
      return;
    }

    setMessage("Offer submitted successfully!");
    form.reset();
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full border rounded py-3 font-bold"
      >
        Make Best Offer
      </button>

      {open && (
        <form onSubmit={submitOffer} className="mt-4 border rounded p-4 space-y-3">
          <input
            name="name"
            required
            placeholder="Your name"
            className="w-full border rounded p-2"
          />

          <input
            name="email"
            type="email"
            required
            placeholder="Your email"
            className="w-full border rounded p-2"
          />

          <input
            name="offerAmount"
            type="number"
            required
            min="1"
            step="0.01"
            placeholder={`Offer amount, asking $${price.toFixed(2)}`}
            className="w-full border rounded p-2"
          />

          <button
            type="submit"
            className="w-full bg-black text-white rounded py-2 font-bold"
          >
            Submit Offer
          </button>

          {message && <p className="text-sm font-bold">{message}</p>}
        </form>
      )}
    </div>
  );
}