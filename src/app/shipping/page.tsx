import type { Metadata } from "next";
import PolicyShell from "../components/PolicyShell";
import {
  SHIPPING_RULES,
  STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES,
  STANDARD_ENVELOPE_MAX_SUBTOTAL,
  standardEnvelopeRateForEstimatedOunces,
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
  const envelopeRates = Array.from(
    { length: STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES },
    (_, index) => standardEnvelopeRateForEstimatedOunces({ estimatedOunces: index + 1 }),
  );

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
        <h2 className="text-2xl font-black">Available methods and rates</h2>
        <div className="mt-4 space-y-4">
          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.STANDARD_ENVELOPE.name}
            </h3>
            <p className="mt-2">
              Available for eligible raw-card orders up to $
              {STANDARD_ENVELOPE_MAX_SUBTOTAL.toFixed(2)} and up to{" "}
              {STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES} estimated ounces.
            </p>
            <p className="mt-2 font-bold">
              Current ounce rates: {envelopeRates.map((rate) => `$${rate.toFixed(2)}`).join(" · ")}
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              USPS Intelligent Mail barcode visibility is used when available.
              Scan history may be more limited than parcel tracking.
            </p>
          </div>

          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.GROUND_ADVANTAGE.name}
            </h3>
            <p className="mt-2">
              ${SHIPPING_RULES.GROUND_ADVANTAGE.basePrice.toFixed(2)} for the first{" "}
              {SHIPPING_RULES.GROUND_ADVANTAGE.cardsIncluded} cards, plus $
              {SHIPPING_RULES.GROUND_ADVANTAGE.additionalCardPrice.toFixed(2)} for
              each additional card.
            </p>
            <p className="mt-2 font-bold">
              Free at ${SHIPPING_RULES.GROUND_ADVANTAGE.freeShippingThreshold.toFixed(2)}
              or more. Estimated carrier transit: {SHIPPING_RULES.GROUND_ADVANTAGE.deliveryEstimate}.
            </p>
          </div>

          <div className="border-2 border-neutral-950 bg-white p-5">
            <h3 className="text-xl font-black">
              {SHIPPING_RULES.PRIORITY_MAIL.name}
            </h3>
            <p className="mt-2">
              ${SHIPPING_RULES.PRIORITY_MAIL.basePrice.toFixed(2)} for the first{" "}
              {SHIPPING_RULES.PRIORITY_MAIL.cardsIncluded} cards, plus $
              {SHIPPING_RULES.PRIORITY_MAIL.additionalCardPrice.toFixed(2)} for each
              additional card.
            </p>
            <p className="mt-2 font-bold">
              Free at ${SHIPPING_RULES.PRIORITY_MAIL.freeShippingThreshold.toFixed(2)}
              or more. Estimated carrier transit: {SHIPPING_RULES.PRIORITY_MAIL.deliveryEstimate}.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-black">Processing and delivery</h2>
        <p className="mt-2">
          Delivery estimates describe normal carrier transit after a shipment is
          accepted by the carrier. They are not guaranteed delivery dates and do
          not include order review, packing, weekends, holidays, weather events,
          address corrections, or carrier delays.
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
        <h2 className="text-2xl font-black">Returned or undeliverable packages</h2>
        <p className="mt-2">
          Orders returned because of an incomplete, incorrect, refused, or
          undeliverable address may require an additional shipping payment before
          reshipment. Any refund will be evaluated after the returned package is
          received and inspected.
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
