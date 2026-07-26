"use client";

import { useState } from "react";
import BuyerProtectionOption, {
  type BuyerProtectionCheckoutChoice,
} from "../../cart/BuyerProtectionOption";
import { BUYER_PROTECTION_POLICY_VERSION } from "../../../lib/buyer-protection";
import {
  TERMS_OF_SERVICE_PATH,
  TERMS_OF_SERVICE_VERSION,
} from "../../../lib/legal";
import { getAccountSession } from "../../account/account-session";

type MessageTone = "success" | "error" | null;

const EMPTY_PROTECTION_CHOICE: BuyerProtectionCheckoutChoice = {
  selected: false,
  preferenceMode: "one_time",
  termsAccepted: false,
  policyVersion: BUYER_PROTECTION_POLICY_VERSION,
  storedConsentCurrent: false,
};

export default function OfferForm({
  productId,
  price,
}: {
  productId: number;
  price: number;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>(null);
  const [submitting, setSubmitting] = useState(false);
  const [buyerProtection, setBuyerProtection] =
    useState<BuyerProtectionCheckoutChoice>(EMPTY_PROTECTION_CHOICE);

  async function submitOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (submitting) return;
    if (
      buyerProtection.selected &&
      !buyerProtection.storedConsentCurrent &&
      !buyerProtection.termsAccepted
    ) {
      setMessage("Accept the Buyer Protection terms or turn protection off.");
      setMessageTone("error");
      return;
    }

    const form = e.currentTarget;
    const formData = new FormData(form);
    const accountSession = getAccountSession();

    setSubmitting(true);
    setMessage("");
    setMessageTone(null);

    try {
      const res = await fetch("/api/offers/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountSession?.access_token
            ? { Authorization: `Bearer ${accountSession.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          productId,
          name: formData.get("name"),
          email: formData.get("email"),
          offerAmount: Number(formData.get("offerAmount")),
          buyerProtectionSelected: buyerProtection.selected,
          buyerProtectionPreferenceMode: buyerProtection.preferenceMode,
          buyerProtectionTermsAccepted: buyerProtection.termsAccepted,
          buyerProtectionPolicyVersion: buyerProtection.policyVersion,
          tosAccepted: formData.get("tosAccepted") === "on",
          tosVersion: TERMS_OF_SERVICE_VERSION,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Something went wrong.");
        setMessageTone("error");
        return;
      }

      setMessage("Offer submitted successfully!");
      setMessageTone("success");
      form.reset();
    } catch {
      setMessage("Offer could not be submitted. Please try again.");
      setMessageTone("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="min-h-12 w-full rounded border px-4 py-3 text-base font-bold"
      >
        Make Best Offer
      </button>

      {open ? (
        <form onSubmit={submitOffer} className="mt-4 space-y-3 rounded border p-4">
          <input
            name="name"
            required
            autoComplete="name"
            placeholder="Your name"
            className="min-h-12 w-full rounded border px-3 py-2 text-base"
          />

          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="Your email"
            className="min-h-12 w-full rounded border px-3 py-2 text-base"
          />

          <input
            name="offerAmount"
            type="number"
            required
            min="1"
            max={price}
            step="0.01"
            inputMode="decimal"
            placeholder={`Offer amount, asking $${price.toFixed(2)}`}
            className="min-h-12 w-full rounded border px-3 py-2 text-base"
          />

          <BuyerProtectionOption
            available={price <= 20}
            onChange={setBuyerProtection}
          />

          <label className="flex min-h-12 items-start gap-3 rounded border p-3 text-sm leading-6">
            <input
              type="checkbox"
              name="tosAccepted"
              required
              className="mt-1 h-5 w-5 shrink-0"
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
            disabled={submitting}
            className="min-h-12 w-full rounded bg-black px-4 py-3 text-base font-bold text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Offer"}
          </button>

          <div aria-live="polite" className="min-h-6">
            {message ? (
              <p
                className={`text-sm font-bold ${
                  messageTone === "error" ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {message}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
