import type { Metadata } from "next";
import {
  SOFTWARE_OWNER_NAME,
  TERMS_OF_SERVICE_VERSION,
} from "../../lib/legal";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return {
    title: `Terms of Service | ${storeSettings.displayName}`,
    description: `Terms of Service for ${storeSettings.displayName} purchases and offers.`,
  };
}

export default async function TermsPage() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-4xl font-bold">Terms of Service</h1>

      <p className="mt-3 text-sm text-gray-600">
        {SOFTWARE_OWNER_NAME}. {storeSettings.displayName} storefront. Version{" "}
        {TERMS_OF_SERVICE_VERSION}.
      </p>

      <div className="mt-8 space-y-6 text-gray-800">
        <section>
          <h2 className="text-2xl font-bold">1. Agreement</h2>
          <p className="mt-2">
            By creating an account, submitting an offer, or completing a
            purchase through {storeSettings.displayName}, you agree to these
            Terms of Service. If you do not agree, do not submit an offer or
            complete a purchase.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">2. Product Listings</h2>
          <p className="mt-2">
            Product listings are based on the information available to{" "}
            {storeSettings.displayName}
            {" "}
            at the time of listing. Photos, descriptions, pricing,
            availability, and quantities may be updated as inventory is verified
            or synchronized from marketplaces such as eBay.
          </p>
          <p className="mt-2">
            Listings for autographs, memorabilia, and other
            authenticity-sensitive items must clearly disclose whether the item
            is third-party certified, covered by a seller pass guarantee,
            supported only by provenance evidence, or fully unverified. Buyers
            should review those disclosures, listing photos, certification
            details, certificate numbers, envelope scans, provenance notes, and
            any seller guarantee language before purchasing.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">3. Pricing And Availability</h2>
          <p className="mt-2">
            Prices and availability may change before checkout is completed. An
            item is not reserved until payment is completed or{" "}
            {storeSettings.displayName} confirms a specific reservation in
            writing.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">4. Orders And Payment</h2>
          <p className="mt-2">
            Payments are processed through Stripe. Orders are reviewed after
            payment for inventory availability, payment status, and fulfillment
            details. {storeSettings.displayName} may cancel and refund an order
            if an item is unavailable, incorrectly listed, or cannot be
            fulfilled.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">5. Offers</h2>
          <p className="mt-2">
            Submitted offers are not accepted until {storeSettings.displayName}{" "}
            approves the offer and payment is completed. Counter offers and
            accepted offers may expire or be canceled if inventory is no longer
            available.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">6. Shipping</h2>
          <p className="mt-2">
            Shipping options, costs, carriers, and delivery timeframes are shown
            during checkout when available. Delivery dates are estimates and may
            be affected by carrier delays, address issues, weather, or other
            events outside {storeSettings.displayName}&apos;s control.
          </p>
          <p className="mt-2">
            {storeSettings.displayName} currently ships only to addresses in
            the United States. Orders, accepted offers, or counter offers
            requiring shipment outside the United States cannot be completed at
            this time.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">
            7. Authenticity And Certification Claims
          </h2>
          <p className="mt-2">
            If a listing states that an item is third-party certified, verified,
            or guaranteed to pass authentication from a named provider such as
            JSA, PSA DNA, or Beckett, that claim becomes part of the transaction
            record and may be enforced through refund, dispute, and seller-review
            processes.
          </p>
          <p className="mt-2">
            If an autograph or memorabilia item is sold as unverified, sold
            as-is, and not guaranteed to pass third-party authentication, the
            buyer accepts the disclosed authentication risk by completing the
            purchase. A later authentication failure alone does not require a
            refund unless the seller made a false, misleading, or unsupported
            authenticity representation.
          </p>
          <p className="mt-2">
            Supporting provenance evidence such as return envelopes, fan-club
            mail, signing photos, correspondence, event tickets, or prior owner
            notes may be shown in a listing to help the buyer make an informed
            decision, but provenance evidence is not the same as third-party
            certification unless the listing clearly says otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">8. Returns And Issues</h2>
          <p className="mt-2">
            If there is a problem with an order, contact{" "}
            {storeSettings.displayName} as soon as possible with the order
            information and photos when relevant. Return, refund, and
            cancellation decisions may depend on item condition, order status,
            marketplace requirements, payment processor requirements, and
            applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">9. Customer Information</h2>
          <p className="mt-2">
            Customers must provide accurate contact, payment, and shipping
            information. {storeSettings.displayName} uses customer information
            to manage orders, offers, payment, shipping, fraud prevention,
            support, and legal compliance.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">10. Account And Purchase Conduct</h2>
          <p className="mt-2">
            Customers may not use the site for fraud, abuse, unauthorized
            chargebacks, false information, interference with inventory systems,
            or any activity that disrupts store operations.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">11. Contact</h2>
          <p className="mt-2">
            Questions about these terms, orders, offers, or account activity can
            be sent to {storeSettings.displayName} through the contact method
            provided on the storefront or order communications.
          </p>
        </section>
      </div>
    </main>
  );
}
