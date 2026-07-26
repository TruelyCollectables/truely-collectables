import type { Metadata } from "next";
import PolicyShell from "../components/PolicyShell";
import {
  FREE_PRIORITY_MAIL_THRESHOLD,
  GROUND_ADVANTAGE_TEN_OUNCE_MAX_CARDS,
  GROUND_ADVANTAGE_TEN_OUNCE_MIN_CARDS,
  GROUND_ADVANTAGE_TEN_OUNCE_PRICE,
  PRIORITY_MAIL_BUYER_PRICE,
  PRIORITY_MAIL_MIN_CARDS,
  SHIPPING_RULES,
  STANDARD_ENVELOPE_BUYER_PRICE,
  STANDARD_ENVELOPE_MAX_CARDS,
  STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES,
  STANDARD_ENVELOPE_MAX_SUBTOTAL,
} from "../../lib/shipping";
import {
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../../lib/legal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: `Shipping methods, rates, tracking, and delivery information for ${STORE_BRAND_NAME}.`,
};

export default function ShippingPage() {
  return (
    <PolicyShell eyebrow={STORE_LEGAL_NAME} title="Shipping Policy">
      <section>
        <h2 className="text-2xl font-black">Where we ship</h2>
        <p className="mt-2">
          {STORE_BRAND_NAME} currently ships only to valid United States delivery
          addresses. The buyer is responsible for providing a complete and
          accurate address before payment.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Shipping choices and minimum tiers</h2>
        <p className="mt-2">
          Checkout automatically selects the lowest eligible method. Buyers may
          upgrade to any premium method shown in the shipping dropdown. A buyer
          cannot select a method below the order&apos;s required minimum.
        </p>
        <div className="mt-4 space-y-4">
          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.STANDARD_ENVELOPE.name}
            </h3>
            <p className="mt-2 font-bold">
              ${STANDARD_ENVELOPE_BUYER_PRICE.toFixed(2)} for up to{" "}
              {STANDARD_ENVELOPE_MAX_CARDS} qualifying raw cards with a combined
              original listing-price total of ${STANDARD_ENVELOPE_MAX_SUBTOTAL.toFixed(2)}
              or less and a maximum estimated weight of{" "}
              {STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES} ounces.
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              LetterTrack / USPS Intelligent Mail barcode scan visibility is used
              when available. This is limited letter visibility, not guaranteed
              package tracking, insurance, or proof of delivery.
            </p>
          </div>

          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.GROUND_ADVANTAGE.name}
            </h3>
            <p className="mt-2">
              $6.99 for 1–5 cards. Cards 6–12 add $0.25 each after the fifth card.
            </p>
            <p className="mt-2 font-bold">
              {GROUND_ADVANTAGE_TEN_OUNCE_MIN_CARDS}–
              {GROUND_ADVANTAGE_TEN_OUNCE_MAX_CARDS} cards use the 10-ounce Ground
              Advantage tier at ${GROUND_ADVANTAGE_TEN_OUNCE_PRICE.toFixed(2)}.
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              Estimated carrier transit: {SHIPPING_RULES.GROUND_ADVANTAGE.deliveryEstimate}.
            </p>
          </div>

          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.PRIORITY_MAIL.name}
            </h3>
            <p className="mt-2">
              ${PRIORITY_MAIL_BUYER_PRICE.toFixed(2)} for orders containing{" "}
              {PRIORITY_MAIL_MIN_CARDS} or more cards, or whenever the buyer chooses
              Priority Mail as a premium upgrade.
            </p>
            <p className="mt-2 font-bold">
              Orders over ${FREE_PRIORITY_MAIL_THRESHOLD.toFixed(2)} ship by Priority
              Mail free.
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              Estimated carrier transit: {SHIPPING_RULES.PRIORITY_MAIL.deliveryEstimate}.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-black">Accepted offers</h2>
        <p className="mt-2">
          The original listing price controls the minimum shipping tier. An accepted
          offer does not unlock cheaper shipping. For example, a card listed at $24
          and sold through an $18 offer still requires Ground Advantage or Priority
          Mail. A card originally listed at $20 remains eligible for the Tracked Card
          Letter when all physical limits are met.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Physical card-letter limits</h2>
        <p className="mt-2">
          The Tracked Card Letter is for raw cards only. The sealed mailpiece must
          remain within the stated card-count, weight, thickness, size, flexibility,
          and machinability limits. Graded slabs, magnetic holders, thick memorabilia
          cards, oversized cards, or any mailpiece that fails the letter requirements
          must use Ground Advantage or Priority Mail.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Processing and delivery</h2>
        <p className="mt-2">
          Delivery estimates describe normal carrier transit after a shipment is
          accepted by the carrier. They are not guaranteed delivery dates and do not
          include order review, packing, weekends, holidays, weather events, address
          corrections, or carrier delays.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Tracking and shipment issues</h2>
        <p className="mt-2">
          Tracking or delivery evidence is provided when available for the selected
          method. Contact us promptly if tracking stalls, a package is damaged, an
          item is missing, or the shipment appears to have been delivered to the
          wrong location. Keep the packaging and take clear photos when damage is
          involved.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Contact</h2>
        <p className="mt-2">
          Shipping questions may be sent to{" "}
          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="font-black underline decoration-2 underline-offset-4"
          >
            {STORE_SUPPORT_EMAIL}
          </a>
          . Include the order number when available.
        </p>
      </section>
    </PolicyShell>
  );
}
