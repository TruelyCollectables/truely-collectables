import type { Metadata } from "next";
import {
  SELLER_COMMISSION_RATE,
  SELLER_TERMS_OF_SERVICE_VERSION,
  SOFTWARE_OWNER_NAME,
  STORE_BRAND_NAME,
} from "../../lib/legal";

const commissionPercent = `${SELLER_COMMISSION_RATE * 100}%`;

export const metadata: Metadata = {
  title: "Seller Terms of Service | Truely Collectables",
  description:
    "Seller Terms of Service for Truely Collectables auction and seller accounts.",
};

export default function SellerTermsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-4xl font-bold">Seller Terms of Service</h1>

      <p className="mt-3 text-sm text-gray-600">
        {SOFTWARE_OWNER_NAME}. {STORE_BRAND_NAME} seller program. Version{" "}
        {SELLER_TERMS_OF_SERVICE_VERSION}.
      </p>

      <div className="mt-8 space-y-6 text-gray-800">
        <section>
          <h2 className="text-2xl font-bold">1. Agreement</h2>
          <p className="mt-2">
            By creating a seller account, submitting an item for auction, or
            using seller tools provided by Truely Collectables, you agree to
            these Seller Terms of Service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">2. Seller Eligibility</h2>
          <p className="mt-2">
            Sellers must provide accurate account, identity, contact, payout,
            tax, and item information when requested. Truely Collectables may
            refuse, suspend, or remove seller access if the account cannot be
            verified or if seller activity creates operational, payment,
            compliance, or fraud risk.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">3. Required Seller Acceptance</h2>
          <p className="mt-2">
            Sellers must accept the current Seller Terms of Service before
            listing items, submitting auction inventory, receiving payouts, or
            using future seller account tools.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">4. Bank And Payout Verification</h2>
          <p className="mt-2">
            Seller bank and payout information must be verified by an approved
            third-party payment, banking, or identity verification provider
            before seller payouts are enabled. Raw bank credentials should not
            be stored directly in TCOS.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">5. Auction And Listing Authority</h2>
          <p className="mt-2">
            Sellers must own or have the legal right to sell every submitted
            item. Sellers are responsible for accurate descriptions, condition
            information, images, authenticity claims, grading claims, serial
            number details, and any other listing information they provide.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">6. Seller Commission</h2>
          <p className="mt-2">
            Truely Collectables charges a seller commission equal to{" "}
            <strong>{commissionPercent}</strong> of the total sale amount for
            the seller item. The total sale amount includes the item sale price
            plus shipping paid by the buyer.
          </p>
          <p className="mt-2">
            The commission is calculated before seller payout. Payment
            processing fees, shipping label costs, refunds, chargebacks,
            adjustments, taxes, or other applicable deductions may also affect
            final payout when they apply.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">7. Payouts</h2>
          <p className="mt-2">
            Seller payouts are available only after buyer payment, required
            verification, order review, and any applicable hold, dispute,
            fulfillment, or compliance period. Truely Collectables may delay or
            withhold payout when fraud, authenticity, payment, shipping,
            dispute, or legal concerns exist.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">8. Shipping And Fulfillment</h2>
          <p className="mt-2">
            Seller shipping duties will depend on the auction workflow selected
            by Truely Collectables. Sellers must follow the shipping, packaging,
            delivery, tracking, and handoff rules shown in the seller account
            workflow when that feature is available.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">9. Returns, Disputes, And Chargebacks</h2>
          <p className="mt-2">
            Returns, refunds, disputes, chargebacks, authenticity concerns, and
            item-not-as-described claims may reduce or reverse seller payout.
            Sellers must cooperate with requests for documents, photos,
            shipment proof, provenance, or item details.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">10. Prohibited Activity</h2>
          <p className="mt-2">
            Sellers may not submit counterfeit items, stolen items, manipulated
            listings, shill bids, false condition claims, false ownership
            claims, misleading images, payment fraud, payout fraud, or activity
            that interferes with marketplace trust.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">11. Contact</h2>
          <p className="mt-2">
            Seller questions, payout questions, auction questions, or listing
            issues can be sent to Truely Collectables through the contact method
            provided in seller communications.
          </p>
        </section>
      </div>
    </main>
  );
}
