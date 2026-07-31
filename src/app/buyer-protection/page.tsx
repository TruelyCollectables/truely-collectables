import type { Metadata } from "next";
import Link from "next/link";
import PolicyShell from "../components/PolicyShell";
import {
  BUYER_PROTECTION_CLAIM_DEADLINE_DAYS,
  BUYER_PROTECTION_MAX_ITEM_SUBTOTAL,
  BUYER_PROTECTION_MIN_CLAIM_DAYS,
  BUYER_PROTECTION_POLICY_VERSION,
  BUYER_PROTECTION_RATE,
  BUYER_PROTECTION_TERMS_SUMMARY,
} from "../../lib/buyer-protection";
import {
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "Shipment Protection Terms",
  description: `Optional under-$20 Tracked Card Letter shipment-protection terms for ${STORE_BRAND_NAME}.`,
};

export default function BuyerProtectionPage() {
  return (
    <PolicyShell
      eyebrow={STORE_LEGAL_NAME}
      title="Truely Collectables Shipment Protection"
    >
      <section className="rounded border-2 border-violet-900 bg-violet-50 p-5 text-violet-950">
        <p className="text-sm font-black uppercase tracking-wide">
          Current version: {BUYER_PROTECTION_POLICY_VERSION}
        </p>
        <p className="mt-3 font-semibold leading-7">
          This is an optional reimbursement program offered directly by {STORE_BRAND_NAME}.
          It is not insurance, USPS coverage, or guaranteed delivery. It does not replace
          rights that cannot legally be waived or rights available through a payment provider.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Cost and coverage</h2>
        <p className="mt-2">
          Shipment Protection costs {(BUYER_PROTECTION_RATE * 100).toFixed(0)}% of
          the item subtotal plus shipping, calculated before the protection fee is
          added. It is available for qualifying Tracked Card Letter orders with an
          item subtotal of ${BUYER_PROTECTION_MAX_ITEM_SUBTOTAL.toFixed(2)} or less.
          An approved claim reimburses the protected item subtotal and shipping shown
          at checkout. The protection fee itself is not reimbursed.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Qualifying loss or damage</h2>
        <p className="mt-2">
          Claims may be reviewed for carrier loss or damage. Approval requires the
          available USPS or LetterTrack trail, order records, buyer statements, and
          photographs of the item, mailer, and damage when applicable. A submitted
          claim is not automatically approved.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Claim window</h2>
        <p className="mt-2">
          The shipment must be at least {BUYER_PROTECTION_MIN_CLAIM_DAYS} full days
          past the recorded shipment timestamp before a claim is submitted. A claim
          must be submitted no later than {BUYER_PROTECTION_CLAIM_DEADLINE_DAYS}
          calendar days after shipment. Claims outside that window are ineligible.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Declining protection</h2>
        <p className="mt-2">
          Buyers who decline must acknowledge the choice for each qualifying order.
          Declining means this voluntary Truely Collectables reimbursement program will
          not apply to that order. The acknowledgment does not waive rights that cannot
          legally be waived or payment-provider dispute rights.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Saved Always On consent</h2>
        <p className="mt-2">
          A signed-in buyer may choose Always On and accept the current policy version
          once. That preference stays active for future qualifying orders until the buyer
          opts out. When these terms change, the saved consent becomes inactive and the
          buyer must review and accept the new version before future charges resume.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Review requirements</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          {BUYER_PROTECTION_TERMS_SUMMARY.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-black">Submit or manage protection</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/account/buyer-protection"
            className="rounded bg-neutral-950 px-4 py-3 font-black text-white"
          >
            Manage Preference and Claims
          </Link>
          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="rounded border border-neutral-300 px-4 py-3 font-black"
          >
            Email {STORE_SUPPORT_EMAIL}
          </a>
        </div>
      </section>
    </PolicyShell>
  );
}
