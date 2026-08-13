import type { Metadata } from "next";
import Link from "next/link";
import PolicyShell from "../components/PolicyShell";
import {
  CONTACT_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "About",
  description: `About ${STORE_LEGAL_NAME}, the business that operates ${STORE_BRAND_NAME} and TruelyCollectables.com.`,
};

export default function AboutPage() {
  return (
    <PolicyShell eyebrow={STORE_LEGAL_NAME} title="About Truely Collectables">
      <section>
        <h2 className="text-2xl font-black">Who we are</h2>
        <p className="mt-2">
          {STORE_LEGAL_NAME} operates {STORE_BRAND_NAME} and TruelyCollectables.com as
          an online store for sports cards and other collectibles. Customers can
          browse current inventory, review listing photos and product details, and
          complete payment through the store&apos;s secure checkout.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Inventory and availability</h2>
        <p className="mt-2">
          Products shown as available are listed from the store&apos;s current inventory.
          Some inventory may also be synchronized with marketplace listings, so
          quantities can change when an item sells through another active sales
          channel. If an inventory conflict prevents fulfillment after payment, the
          order is canceled and refunded to the original payment method.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Pricing and checkout</h2>
        <p className="mt-2">
          Product prices are shown in U.S. dollars. Applicable shipping charges and
          taxes are presented before the customer completes payment. Payments are
          processed through Stripe; {STORE_LEGAL_NAME} does not store complete
          payment-card numbers.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Brands and marketplace references</h2>
        <p className="mt-2">
          Manufacturer, league, team, athlete, grading-company, authentication-company,
          and marketplace names may appear to describe a product, certification, or
          listing source. Those references do not imply sponsorship, endorsement, or
          an official partnership unless a listing or page expressly states otherwise.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Policies and support</h2>
        <p className="mt-2">
          Shipping methods, return and refund rules, and customer-support information
          are published before purchase and linked throughout the storefront.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={SHIPPING_POLICY_PATH}
            className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black shadow-[3px_3px_0_#111318]"
          >
            Shipping Policy
          </Link>
          <Link
            href={RETURNS_POLICY_PATH}
            className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black shadow-[3px_3px_0_#111318]"
          >
            Returns & Refunds
          </Link>
          <Link
            href={CONTACT_PATH}
            className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black shadow-[3px_3px_0_#111318]"
          >
            Contact
          </Link>
        </div>
        <p className="mt-5">
          Customer support: <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="font-black underline decoration-2 underline-offset-4"
          >
            {STORE_SUPPORT_EMAIL}
          </a>.
        </p>
      </section>
    </PolicyShell>
  );
}
