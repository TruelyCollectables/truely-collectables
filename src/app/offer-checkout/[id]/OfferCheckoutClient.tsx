"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_PATH,
  BUYER_PROTECTION_POLICY_VERSION,
} from "../../../lib/buyer-protection";
import {
  calculateShipping,
  getAvailableShippingMethods,
  getMinimumShippingMethod,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../../lib/shipping";
import { getAccountSession } from "../../account/account-session";

export default function OfferCheckoutClient(props: {
  offerId: number;
  token: string;
  productId: number;
  title: string;
  imageUrl: string | null;
  saleSubtotal: number;
  listingPriceBasis: number;
  buyerProtectionSelected: boolean;
  buyerProtectionPolicyCurrent: boolean;
}) {
  const minimumShippingMethod = getMinimumShippingMethod({
    itemCount: 1,
    subtotal: props.saleSubtotal,
    listingPriceBasis: props.listingPriceBasis,
  });
  const availableMethods = getAvailableShippingMethods({
    itemCount: 1,
    subtotal: props.saleSubtotal,
    listingPriceBasis: props.listingPriceBasis,
  });
  const [shippingMethod, setShippingMethod] =
    useState<ShippingMethod>(minimumShippingMethod);
  const [protectionSelected, setProtectionSelected] = useState(
    props.buyerProtectionSelected &&
      props.buyerProtectionPolicyCurrent &&
      minimumShippingMethod === "STANDARD_ENVELOPE",
  );
  const [protectionTermsAccepted, setProtectionTermsAccepted] = useState(
    props.buyerProtectionSelected && props.buyerProtectionPolicyCurrent,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const protectionAvailable = shippingMethod === "STANDARD_ENVELOPE";
  const shippingAmount = useMemo(
    () =>
      calculateShipping({
        itemCount: 1,
        subtotal: props.saleSubtotal,
        listingPriceBasis: props.listingPriceBasis,
        method: shippingMethod,
      }),
    [shippingMethod, props.saleSubtotal, props.listingPriceBasis],
  );
  const protectionFee =
    protectionAvailable && protectionSelected ? BUYER_PROTECTION_FEE : 0;
  const total = props.saleSubtotal + shippingAmount + protectionFee;
  const storedConsentCurrent =
    props.buyerProtectionSelected && props.buyerProtectionPolicyCurrent;

  function chooseShipping(next: ShippingMethod) {
    setShippingMethod(next);
    if (next !== "STANDARD_ENVELOPE") {
      setProtectionSelected(false);
    }
  }

  async function proceed() {
    if (loading) return;
    if (
      protectionSelected &&
      !storedConsentCurrent &&
      !protectionTermsAccepted
    ) {
      setError("Accept the current Buyer Protection terms before continuing.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const accountSession = getAccountSession();
      const response = await fetch("/api/offers/buyer-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountSession?.access_token
            ? { Authorization: `Bearer ${accountSession.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          offerId: props.offerId,
          token: props.token,
          shippingMethod,
          buyerProtectionSelected:
            protectionAvailable && protectionSelected,
          buyerProtectionTermsAccepted: protectionTermsAccepted,
          buyerProtectionPolicyVersion: BUYER_PROTECTION_POLICY_VERSION,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Could not start payment");
      }

      window.location.href = payload.url;
    } catch (paymentError: any) {
      setError(paymentError.message || "Could not start payment");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-black uppercase tracking-wide text-neutral-500">
          Accepted offer checkout
        </p>
        <h1 className="mt-2 text-4xl font-black">Choose Shipping and Protection</h1>
        <p className="mt-3 text-neutral-600">
          Your original listing price controls the minimum shipping tier. Premium
          upgrades remain available.
        </p>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[260px_1fr]">
        <section className="rounded border bg-white p-4">
          {props.imageUrl ? (
            <Image
              src={props.imageUrl}
              alt={props.title}
              width={500}
              height={625}
              quality={90}
              className="aspect-[4/5] w-full object-contain"
            />
          ) : null}
          <h2 className="mt-4 text-xl font-black">{props.title}</h2>
          <p className="mt-2 text-3xl font-black">
            ${props.saleSubtotal.toFixed(2)}
          </p>
          <Link
            href={`/product/${props.productId}`}
            className="mt-4 inline-block font-black underline"
          >
            View Card
          </Link>
        </section>

        <section className="rounded border bg-white p-5">
          <label htmlFor="offer-shipping" className="text-lg font-black">
            Shipping method
          </label>
          <select
            id="offer-shipping"
            value={shippingMethod}
            onChange={(event) =>
              chooseShipping(event.target.value as ShippingMethod)
            }
            className="mt-2 min-h-12 w-full rounded border px-3 text-base font-bold"
          >
            {availableMethods.map((method) => {
              const amount = calculateShipping({
                itemCount: 1,
                subtotal: props.saleSubtotal,
                listingPriceBasis: props.listingPriceBasis,
                method,
              });
              return (
                <option key={method} value={method}>
                  {SHIPPING_RULES[method].name} — {amount === 0 ? "FREE" : `$${amount.toFixed(2)}`}
                </option>
              );
            })}
          </select>

          <div className="mt-4 rounded border border-violet-200 bg-violet-50 p-4 text-violet-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">
                  Buyer Protection — ${BUYER_PROTECTION_FEE.toFixed(2)}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  Covers the item amount up to $20. Shipping and the fee are excluded.
                </p>
              </div>
              <Link
                href={BUYER_PROTECTION_PATH}
                target="_blank"
                className="shrink-0 font-black underline"
              >
                Terms
              </Link>
            </div>

            {protectionAvailable ? (
              <label className="mt-3 flex items-start gap-3 rounded border border-violet-200 bg-white p-3 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={protectionSelected}
                  onChange={(event) => {
                    setProtectionSelected(event.target.checked);
                    if (!event.target.checked) {
                      setProtectionTermsAccepted(false);
                    }
                  }}
                  className="mt-1 h-5 w-5"
                />
                Add optional Buyer Protection to this order.
              </label>
            ) : (
              <p className="mt-3 rounded border border-neutral-200 bg-white p-3 text-sm font-bold">
                Ground Advantage and Priority Mail use parcel tracking; the $0.75
                Tracked Card Letter protection does not apply.
              </p>
            )}

            {protectionSelected && !storedConsentCurrent ? (
              <label className="mt-3 flex items-start gap-3 rounded border border-violet-300 bg-white p-3 text-sm leading-6">
                <input
                  type="checkbox"
                  checked={protectionTermsAccepted}
                  onChange={(event) =>
                    setProtectionTermsAccepted(event.target.checked)
                  }
                  className="mt-1 h-5 w-5"
                />
                I accept version {BUYER_PROTECTION_POLICY_VERSION}. I understand a
                shipment must be missing for 7 full days and the claim deadline is
                21 calendar days after shipment. Reimbursement excludes shipping and
                the protection fee.
              </label>
            ) : protectionSelected ? (
              <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-950">
                Your existing current-version consent applies to this protected offer.
              </p>
            ) : null}
          </div>

          <dl className="mt-5 space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <dt>Accepted price</dt>
              <dd className="font-black">${props.saleSubtotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd className="font-black">${shippingAmount.toFixed(2)}</dd>
            </div>
            {protectionFee > 0 ? (
              <div className="flex justify-between">
                <dt>Buyer Protection</dt>
                <dd className="font-black">${protectionFee.toFixed(2)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t pt-3 text-xl">
              <dt className="font-black">Total</dt>
              <dd className="font-black">${total.toFixed(2)}</dd>
            </div>
          </dl>

          {error ? (
            <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 font-bold text-red-950">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={proceed}
            disabled={loading}
            className="mt-5 min-h-12 w-full rounded bg-neutral-950 px-5 py-3 text-lg font-black text-white disabled:opacity-50"
          >
            {loading ? "Opening Secure Payment…" : "Continue to Secure Payment"}
          </button>
        </section>
      </div>
    </main>
  );
}
