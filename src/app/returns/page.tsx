import type { Metadata } from "next";
import PolicyShell from "../components/PolicyShell";
import {
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "Returns & Refunds",
  description: `Return, refund, cancellation, and order-issue policy for ${STORE_BRAND_NAME}.`,
};

export default function ReturnsPage() {
  return (
    <PolicyShell eyebrow={STORE_LEGAL_NAME} title="Returns & Refunds">
      <section>
        <h2 className="text-2xl font-black">Collectibles are generally final sale</h2>
        <p className="mt-2">
          Sports cards and other collectibles are generally final sale because
          condition, scarcity, and market value can change quickly. This does not
          limit remedies required by law or the protections below for legitimate
          order problems.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Problems we will review</h2>
        <p className="mt-2">
          Contact us promptly if you receive the wrong item, an item is missing,
          the shipment arrives materially damaged, the item is materially different
          from the listing, or the order cannot be fulfilled. Include the order
          number, a clear description of the problem, and photos of the item and
          packaging when relevant.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Condition and grading expectations</h2>
        <p className="mt-2">
          Raw cards are sold based on the listing photos and description and are not
          guaranteed to receive a particular grade. Differences in personal grading
          opinion, later market-price changes, or buyer remorse are not normally a
          basis for return. Graded cards are sold according to the visible holder,
          label, certification information, and disclosed holder condition.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Autographs and authenticity claims</h2>
        <p className="mt-2">
          Any third-party certification, seller guarantee, provenance evidence, or
          unverified status stated in the listing is part of the transaction record.
          Authenticity-related requests are evaluated against the exact listing
          disclosures and the Terms of Service.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Return authorization</h2>
        <p className="mt-2">
          Do not mail an item back before receiving return instructions. Approved
          returns must be sent in the same condition and protective materials in
          which they were received. Items altered, opened, switched, damaged after
          delivery, or returned without authorization may be denied.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Refunds and cancellations</h2>
        <p className="mt-2">
          Approved refunds are issued to the original payment method after the
          relevant order issue is verified and, when required, the returned item is
          received and inspected. Payment processors and banks control the time it
          takes a completed refund to appear. Orders may also be canceled and
          refunded if inventory is unavailable, incorrectly listed, or cannot be
          fulfilled.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Shipping costs</h2>
        <p className="mt-2">
          When the store shipped the wrong item or confirms another qualifying
          fulfillment problem, reasonable return-shipping instructions will be
          provided. Original or return shipping is not normally refundable for
          buyer-remorse requests or other discretionary returns.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Start an order review</h2>
        <p className="mt-2">
          Email{" "}
          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="font-black underline decoration-2 underline-offset-4"
          >
            {STORE_SUPPORT_EMAIL}
          </a>{" "}
          with the order number and supporting photos. Do not send full payment-card
          numbers, passwords, or other sensitive credentials by email.
        </p>
      </section>
    </PolicyShell>
  );
}
