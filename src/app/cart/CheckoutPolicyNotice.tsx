import Link from "next/link";
import {
  CONTACT_PATH,
  PRIVACY_POLICY_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
} from "../../lib/legal";

const links = [
  [SHIPPING_POLICY_PATH, "Shipping"],
  [RETURNS_POLICY_PATH, "Returns & Refunds"],
  [PRIVACY_POLICY_PATH, "Privacy"],
  [CONTACT_PATH, "Contact"],
] as const;

export default function CheckoutPolicyNotice() {
  return (
    <aside className="mx-auto mb-10 mt-2 max-w-5xl px-6">
      <div className="border-2 border-neutral-950 bg-white p-5 shadow-[4px_4px_0_#111318]">
        <p className="font-black">Before payment</p>
        <p className="mt-1 text-sm font-semibold text-neutral-700">
          Review shipping rates, return rules, privacy information, and the support
          contact before completing checkout.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              target="_blank"
              className="text-sm font-black text-blue-700 underline decoration-2 underline-offset-4"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
