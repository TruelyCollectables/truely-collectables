import type { Metadata } from "next";
import {
  SOFTWARE_OWNER_NAME,
  STORE_BRAND_NAME,
  TERMS_OF_SERVICE_VERSION,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Truely Collectables",
  description: "Terms of Service for Truely Collectables purchases and offers.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-4xl font-bold">Terms of Service</h1>

      <p className="mt-3 text-sm text-gray-600">
        {SOFTWARE_OWNER_NAME}. {STORE_BRAND_NAME} storefront. Version{" "}
        {TERMS_OF_SERVICE_VERSION}.
      </p>

      <div className="mt-8 space-y-6 text-gray-800">
        <section>
          <h2 className="text-2xl font-bold">1. Agreement</h2>
          <p className="mt-2">
            By creating an account, submitting an offer, or completing a
            purchase through Truely Collectables, you agree to these Terms of
            Service. If you do not agree, do not submit an offer or complete a
            purchase.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">2. Product Listings</h2>
          <p className="mt-2">
            Product listings are based on the information available to Truely
            Collectables at the time of listing. Photos, descriptions, pricing,
            availability, and quantities may be updated as inventory is verified
            or synchronized from marketplaces such as eBay.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">3. Pricing And Availability</h2>
          <p className="mt-2">
            Prices and availability may change before checkout is completed. An
            item is not reserved until payment is completed or Truely
            Collectables confirms a specific reservation in writing.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">4. Orders And Payment</h2>
          <p className="mt-2">
            Payments are processed through Stripe. Orders are reviewed after
            payment for inventory availability, payment status, and fulfillment
            details. Truely Collectables may cancel and refund an order if an
            item is unavailable, incorrectly listed, or cannot be fulfilled.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">5. Offers</h2>
          <p className="mt-2">
            Submitted offers are not accepted until Truely Collectables approves
            the offer and payment is completed. Counter offers and accepted
            offers may expire or be canceled if inventory is no longer
            available.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">6. Shipping</h2>
          <p className="mt-2">
            Shipping options, costs, carriers, and delivery timeframes are shown
            during checkout when available. Delivery dates are estimates and may
            be affected by carrier delays, address issues, weather, or other
            events outside Truely Collectables' control.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">7. Returns And Issues</h2>
          <p className="mt-2">
            If there is a problem with an order, contact Truely Collectables as
            soon as possible with the order information and photos when
            relevant. Return, refund, and cancellation decisions may depend on
            item condition, order status, marketplace requirements, payment
            processor requirements, and applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">8. Customer Information</h2>
          <p className="mt-2">
            Customers must provide accurate contact, payment, and shipping
            information. Truely Collectables uses customer information to manage
            orders, offers, payment, shipping, fraud prevention, support, and
            legal compliance.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">9. Account And Purchase Conduct</h2>
          <p className="mt-2">
            Customers may not use the site for fraud, abuse, unauthorized
            chargebacks, false information, interference with inventory systems,
            or any activity that disrupts store operations.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold">10. Contact</h2>
          <p className="mt-2">
            Questions about these terms, orders, offers, or account activity can
            be sent to Truely Collectables through the contact method provided
            on the storefront or order communications.
          </p>
        </section>
      </div>
    </main>
  );
}
