import type { Metadata } from "next";
import Link from "next/link";
import PolicyShell from "../components/PolicyShell";
import {
  PRIVACY_POLICY_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
  TERMS_OF_SERVICE_PATH,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "Contact",
  description: `Order, offer, account, and policy support for ${STORE_BRAND_NAME}.`,
};

export default function ContactPage() {
  return (
    <PolicyShell eyebrow={STORE_LEGAL_NAME} title="Contact Truely Collectables">
      <section className="border-2 border-neutral-950 bg-white p-6 shadow-[4px_4px_0_#111318]">
        <h2 className="text-2xl font-black">Email support</h2>
        <a
          href={`mailto:${STORE_SUPPORT_EMAIL}`}
          className="mt-3 inline-block text-xl font-black text-blue-700 underline decoration-2 underline-offset-4"
        >
          {STORE_SUPPORT_EMAIL}
        </a>
        <p className="mt-3">
          Use this address for order questions, shipping issues, returns, refunds,
          offers, account activity, privacy requests, and storefront support.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">What to include</h2>
        <p className="mt-2">
          Include your order number, offer reference, or the product title when
          available. For damage, condition, wrong-item, or missing-item reports,
          attach clear photos of the item, packaging, shipping label, and any visible
          damage.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Protect your information</h2>
        <p className="mt-2">
          Do not email full payment-card numbers, passwords, Social Security
          numbers, recovery codes, or other sensitive credentials. We will never ask
          you to send a complete card number or account password by email.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Store policies</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {[
            [SHIPPING_POLICY_PATH, "Shipping"],
            [RETURNS_POLICY_PATH, "Returns & Refunds"],
            [PRIVACY_POLICY_PATH, "Privacy"],
            [TERMS_OF_SERVICE_PATH, "Terms of Service"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black shadow-[3px_3px_0_#111318]"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </PolicyShell>
  );
}
