import type { Metadata } from "next";
import PolicyShell from "../components/PolicyShell";
import {
  PRIVACY_POLICY_VERSION,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
  STORE_SUPPORT_EMAIL,
} from "../../lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${STORE_BRAND_NAME} collects, uses, and protects customer information.`,
};

export default function PrivacyPage() {
  return (
    <PolicyShell
      eyebrow={STORE_LEGAL_NAME}
      title="Privacy Policy"
      updated={PRIVACY_POLICY_VERSION}
    >
      <section>
        <h2 className="text-2xl font-black">Information we collect</h2>
        <p className="mt-2">
          We may collect contact information, shipping details, account and offer
          activity, order history, customer-support messages, fraud-prevention
          signals, and technical information needed to operate and secure the
          storefront. Your browser may also store cart and session information so
          the site can remember your selections and account state.
        </p>
        <p className="mt-2">
          Payments are processed by Stripe. {STORE_BRAND_NAME} does not receive or
          store your complete payment-card number.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">How we use information</h2>
        <p className="mt-2">
          We use customer information to operate accounts, process purchases and
          offers, reserve inventory, collect payment, ship orders, provide tracking
          and support, prevent fraud and abuse, maintain transaction records,
          improve the storefront, and comply with legal and payment-processor
          requirements.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Service providers and disclosures</h2>
        <p className="mt-2">
          We share information only as reasonably needed with service providers
          that support payment processing, database and hosting services, email,
          fraud prevention, shipping, tracking, customer support, and inventory or
          marketplace synchronization. We may also disclose information when
          required by law, to protect customers or the store, or in connection with
          a business transfer.
        </p>
        <p className="mt-2">
          We do not sell customer personal information to advertisers.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Cookies and local storage</h2>
        <p className="mt-2">
          The storefront uses browser cookies, local storage, and similar
          technologies for essential features such as account sessions, security,
          checkout state, and shopping-cart persistence. Blocking those features
          may prevent parts of the site from working correctly.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Retention and security</h2>
        <p className="mt-2">
          We keep information for as long as reasonably needed for orders,
          accounting, fraud prevention, disputes, support, and legal obligations.
          We use administrative, technical, and organizational safeguards, but no
          online system can guarantee absolute security.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Your choices</h2>
        <p className="mt-2">
          You may contact us to request access to, correction of, or deletion of
          personal information where applicable. Some transaction, tax, security,
          and dispute records may need to be retained even after an account is
          closed or a deletion request is made.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Children</h2>
        <p className="mt-2">
          This storefront is not directed to children under 13, and we do not
          knowingly collect personal information from children under 13.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Policy updates</h2>
        <p className="mt-2">
          We may update this policy as the storefront, service providers, or legal
          requirements change. The date above identifies the current version.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-black">Contact</h2>
        <p className="mt-2">
          Privacy questions and requests may be sent to{" "}
          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="font-black underline decoration-2 underline-offset-4"
          >
            {STORE_SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </PolicyShell>
  );
}
