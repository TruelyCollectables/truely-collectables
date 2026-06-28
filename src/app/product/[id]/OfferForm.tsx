"use client";

import { useState } from "react";
import {
  TERMS_OF_SERVICE_PATH,
  TERMS_OF_SERVICE_VERSION,
} from "../../../lib/legal";

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
        tosAccepted: formData.get("tosAccepted") === "on",
        tosVersion: TERMS_OF_SERVICE_VERSION,
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

          <label className="flex items-start gap-3 rounded border p-3 text-sm leading-6">
            <input
              type="checkbox"
              name="tosAccepted"
              required
              className="mt-1"
            />

            <span>
              I agree to the{" "}
              <a
                href={TERMS_OF_SERVICE_PATH}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline"
              >
                Terms of Service
              </a>{" "}
              version {TERMS_OF_SERVICE_VERSION}.
            </span>
          </label>

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
