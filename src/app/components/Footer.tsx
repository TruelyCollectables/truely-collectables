import Link from "next/link";
import { BUYER_PROTECTION_PATH } from "../../lib/buyer-protection";
import {
  ABOUT_PATH,
  CONTACT_PATH,
  PRIVACY_POLICY_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
  STORE_ADDRESS_FORMATTED,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
  STORE_SUPPORT_PHONE,
  STORE_SUPPORT_PHONE_E164,
  TERMS_OF_SERVICE_PATH,
} from "../../lib/legal";

const policyLinks = [
  { href: ABOUT_PATH, label: "About" },
  { href: SHIPPING_POLICY_PATH, label: "Shipping" },
  { href: BUYER_PROTECTION_PATH, label: "Buyer Protection" },
  { href: RETURNS_POLICY_PATH, label: "Returns & Refunds" },
  { href: PRIVACY_POLICY_PATH, label: "Privacy" },
  { href: TERMS_OF_SERVICE_PATH, label: "Terms" },
  { href: CONTACT_PATH, label: "Contact" },
];

export default function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-neutral-950 bg-neutral-950 px-5 py-8 text-white sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-lg font-black">{STORE_BRAND_NAME}</p>
          <p className="mt-1 max-w-xl text-sm font-semibold text-neutral-300">
            {STORE_LEGAL_NAME} operates TruelyCollectables.com as an online sports-card
            and collectibles store with secure checkout, published shipping and return
            policies, and customer support.
          </p>
          <address className="mt-3 not-italic text-sm font-semibold text-neutral-300">
            <span className="block">{STORE_ADDRESS_FORMATTED}</span>
            <a
              href={`tel:${STORE_SUPPORT_PHONE_E164}`}
              className="mt-1 inline-block font-black text-yellow-300 underline decoration-2 underline-offset-4"
            >
              {STORE_SUPPORT_PHONE}
            </a>
            <span className="mx-2 text-neutral-500" aria-hidden="true">
              ·
            </span>
            <a
              href={`mailto:${STORE_SUPPORT_EMAIL}`}
              className="inline-block font-black text-yellow-300 underline decoration-2 underline-offset-4"
            >
              {STORE_SUPPORT_EMAIL}
            </a>
          </address>
        </div>

        <div className="md:text-right">
          <nav
            aria-label="Store policies"
            className="flex flex-wrap gap-x-5 gap-y-3 md:justify-end"
          >
            <Link href="/shop" className="text-sm font-black hover:text-yellow-300">
              Shop
            </Link>
            <Link
              href="/recently-sold"
              className="text-sm font-black hover:text-yellow-300"
            >
              Recently Sold
            </Link>
            {policyLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-black hover:text-yellow-300"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-xs font-semibold text-neutral-400">
            © {new Date().getFullYear()} {STORE_LEGAL_NAME}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
