import type { Metadata } from "next";
import {
  SELLER_COMMISSION_RATE,
  SELLER_TERMS_OF_SERVICE_VERSION,
  SOFTWARE_OWNER_NAME,
} from "../../lib/legal";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";

const commissionPercent = `${SELLER_COMMISSION_RATE * 100}%`;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return {
    title: `Seller Terms of Service | ${storeSettings.displayName}`,
    description: `Seller Terms of Service for ${storeSettings.displayName} auction and seller accounts.`,
  };
}

export default async function SellerTermsPage() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-4xl font-bold">Seller Terms of Service</h1>

      <p className="mt-3 text-sm text-gray-600">
        {SOFTWARE_OWNER_NAME}. {storeSettings.displayName} seller program.
        Version{" "}
        {SELLER_TERMS_OF_SERVICE_VERSION}.
      </p>

      <div className="mt-8 space-y-6 text-gray-800">
        <section>
          <h2 className="text-2xl font-bold">1. Agreement</h2>
          <p className="mt-2">
            By creating a seller account, submitting an item for auction, or
            using seller tools provided by {storeSettings.displayName}, you
            agree to these Seller Terms of Service.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">2. Seller Eligibility</h2>
          <p className="mt-2">
            Sellers must provide accurate account, identity, contact, payout,
            tax, and item information when requested.{" "}
            {storeSettings.displayName} may refuse, suspend, or remove seller
            access if the account cannot be verified or if seller activity
            creates operational, payment, compliance, or fraud risk.
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
          <h2 className="text-2xl font-bold">
            6. Authenticity, Autographs, And Provenance
          </h2>
          <p className="mt-2">
            Sellers may list third-party certified autographs, unverified
            autographs, in-person autographs, through-the-mail autographs, fan
            club returns, and other provenance-supported items only if the
            listing clearly states what is and is not verified.
          </p>
          <p className="mt-2">
            Sellers must clearly disclose, when relevant, whether an item is
            third-party certified, covered by a seller pass guarantee,
            supported by provenance evidence only, or sold as unverified and
            as-is. Supporting evidence such as envelopes, letters, event
            tickets, signing photos, or correspondence must be clearly
            identified in the listing description when the seller relies on
            that evidence to support authenticity.
          </p>
          <p className="mt-2">
            If a seller states or implies that an item will pass third-party
            authentication from a named provider such as JSA, PSA DNA, or
            Beckett, that seller is responsible for the truth of that claim. If
            the claim is proven false through a valid platform review, the
            seller must refund the buyer and may face additional enforcement.
          </p>
          <p className="mt-2">
            If an autograph or authenticity-sensitive item is sold as
            unverified, sold as-is, and not guaranteed to pass third-party
            authentication, the seller is not automatically responsible for a
            refund solely because the buyer later submits the item and it fails
            authentication, provided the seller made no false, misleading, or
            unsupported authenticity representation.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">7. Seller Commission</h2>
          <p className="mt-2">
            {SOFTWARE_OWNER_NAME} charges a seller commission equal to{" "}
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
          <h2 className="text-2xl font-bold">8. Payouts</h2>
          <p className="mt-2">
            Seller payouts are available only after buyer payment, required
            verification, order review, and any applicable hold, dispute,
            fulfillment, or compliance period. {storeSettings.displayName} may
            delay or withhold payout when fraud, authenticity, payment,
            shipping, dispute, or legal concerns exist.
          </p>
          <p className="mt-2">
            Seller payouts are processed through the approved payment processing
            provider. Provider payout timing, reserve, debit, chargeback, instant
            payout, and bank-transfer rules apply unless{" "}
            {storeSettings.displayName} approves another processor or payout
            method in writing.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">9. Shipping And Fulfillment</h2>
          <p className="mt-2">
            Seller shipping duties will depend on the auction workflow selected
            by {storeSettings.displayName}. Sellers must follow the shipping,
            packaging, delivery, tracking, and handoff rules shown in the
            seller account workflow when that feature is available.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">
            10. Returns, Disputes, And Chargebacks
          </h2>
          <p className="mt-2">
            Returns, refunds, disputes, chargebacks, authenticity concerns, and
            item-not-as-described claims may reduce or reverse seller payout.
            Sellers must cooperate with requests for documents, photos,
            shipment proof, provenance, or item details.
          </p>
          <p className="mt-2">
            When a return, dispute, chargeback, authenticity case, or
            item-not-as-described claim is opened against a seller item, related
            seller funds may be held until the case and all available appeals
            are finally decided. If the case is decided against the seller,
            {storeSettings.displayName} may recover the owed amount from held
            funds, future payouts, or the seller&apos;s verified payout or bank
            method according to the payment processor&apos;s rules, including
            recovery within three business days when supported by the provider
            and allowed by applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">
            11. Counterfeit And Authenticity Breach Policy
          </h2>
          <p className="mt-2">
            A seller is in breach of these Seller Terms if an item sold through
            the platform is determined through platform review to be
            counterfeit, fake, materially inauthentic, materially altered in a
            misleading way, or falsely represented as certified, original,
            genuine, or likely to pass a named third-party authentication
            standard.
          </p>
          <p className="mt-2">
            A first confirmed authenticity breach may require a buyer refund, a
            formal seller warning, payout hold, and case record in the platform
            review history. A repeat authenticity breach may result in seller
            suspension, removal, or permanent ban review.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">12. Prohibited Activity</h2>
          <p className="mt-2">
            Sellers may not submit counterfeit items, stolen items, manipulated
            listings, shill bids, false condition claims, false ownership
            claims, misleading images, payment fraud, payout fraud, or activity
            that interferes with marketplace trust.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">13. Contact</h2>
          <p className="mt-2">
            Seller questions, payout questions, auction questions, or listing
            issues can be sent to {storeSettings.displayName} through the
            contact method provided in seller communications.
          </p>
        </section>
      </div>
    </main>
  );
}
