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
    <footer className="mt-auto border-t border-slate-800 bg-[#0b1120] px-5 py-9 text-white sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-2xl font-extrabold uppercase tracking-wide text-white">
            {STORE_BRAND_NAME}
          </p>
          <p className="mt-1.5 max-w-xl text-sm font-medium leading-6 text-slate-300">
            {STORE_LEGAL_NAME} operates TruelyCollectables.com as an online sports-card
            and collectibles store with secure checkout, published shipping and return
            policies, and customer support.
          </p>
          <address className="mt-3 not-italic text-sm font-medium text-slate-300">
            <span className="block">{STORE_ADDRESS_FORMATTED}</span>
            <a
              href={`tel:${STORE_SUPPORT_PHONE_E164}`}
              className="mt-1 inline-block font-bold text-[#facc15] underline decoration-2 underline-offset-4 hover:text-[#eab308]"
            >
              {STORE_SUPPORT_PHONE}
            </a>
            <span className="mx-2 text-slate-600" aria-hidden="true">
              ·
            </span>
            <a
              href={`mailto:${STORE_SUPPORT_EMAIL}`}
              className="inline-block font-bold text-[#facc15] underline decoration-2 underline-offset-4 hover:text-[#eab308]"
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
            <Link href="/shop" className="text-sm font-bold text-slate-200 hover:text-[#facc15]">
              Shop
            </Link>
            <Link
              href="/recently-sold"
              className="text-sm font-bold text-slate-200 hover:text-[#facc15]"
            >
              Recently Sold
            </Link>
            {policyLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-bold text-slate-200 hover:text-[#facc15]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-xs font-medium text-slate-400">
            © {new Date().getFullYear()} {STORE_LEGAL_NAME}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
