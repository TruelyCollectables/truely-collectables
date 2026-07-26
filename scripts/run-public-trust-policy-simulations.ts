import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CONTACT_PATH,
  PRIVACY_POLICY_PATH,
  RETURNS_POLICY_PATH,
  SHIPPING_POLICY_PATH,
  STORE_SUPPORT_EMAIL,
  TERMS_OF_SERVICE_PATH,
} from "../src/lib/legal";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const requiredPages = [
  ["src/app/privacy/page.tsx", "Privacy Policy"],
  ["src/app/shipping/page.tsx", "Shipping Policy"],
  ["src/app/returns/page.tsx", "Returns & Refunds"],
  ["src/app/contact/page.tsx", "Contact Truely Collectables"],
] as const;

for (const [filePath, heading] of requiredPages) {
  assert.equal(fs.existsSync(path.join(process.cwd(), filePath)), true, `${filePath} must exist.`);
  const content = read(filePath);
  assert.ok(content.includes(heading), `${filePath} must contain its public heading.`);
  assert.ok(content.includes("PolicyShell"), `${filePath} must use the shared policy layout.`);
}

assert.equal(STORE_SUPPORT_EMAIL, "sales@truelycollectables.com");
assert.equal(TERMS_OF_SERVICE_PATH, "/terms");
assert.equal(PRIVACY_POLICY_PATH, "/privacy");
assert.equal(SHIPPING_POLICY_PATH, "/shipping");
assert.equal(RETURNS_POLICY_PATH, "/returns");
assert.equal(CONTACT_PATH, "/contact");

const footer = read("src/app/components/Footer.tsx");
for (const token of [
  "SHIPPING_POLICY_PATH",
  "RETURNS_POLICY_PATH",
  "PRIVACY_POLICY_PATH",
  "TERMS_OF_SERVICE_PATH",
  "CONTACT_PATH",
  "STORE_SUPPORT_EMAIL",
]) {
  assert.ok(footer.includes(token), `Footer must include ${token}.`);
}

const layout = read("src/app/layout.tsx");
assert.ok(layout.includes('import Footer from "./components/Footer"'), "Root layout must import the footer.");
assert.ok(layout.includes("<Footer />"), "Root layout must render the footer on every page.");
assert.ok(layout.includes("email: STORE_SUPPORT_EMAIL"), "Organization metadata must expose the support email.");

const terms = read("src/app/terms/page.tsx");
for (const token of [
  "STORE_SUPPORT_EMAIL",
  "SHIPPING_POLICY_PATH",
  "RETURNS_POLICY_PATH",
  "PRIVACY_POLICY_PATH",
  "CONTACT_PATH",
]) {
  assert.ok(terms.includes(token), `Terms must link ${token}.`);
}
assert.doesNotMatch(
  terms,
  /contact method provided on the storefront/i,
  "Terms must not refer to a missing generic contact method.",
);

const cartPage = read("src/app/cart/page.tsx");
assert.ok(cartPage.includes("CheckoutPolicyNotice"), "Cart must render the policy notice before payment.");

const cartNotice = read("src/app/cart/CheckoutPolicyNotice.tsx");
for (const token of [
  "SHIPPING_POLICY_PATH",
  "RETURNS_POLICY_PATH",
  "PRIVACY_POLICY_PATH",
  "CONTACT_PATH",
]) {
  assert.ok(cartNotice.includes(token), `Cart policy notice must include ${token}.`);
}

const shipping = read("src/app/shipping/page.tsx");
assert.ok(shipping.includes("SHIPPING_RULES"), "Shipping policy must use checkout shipping constants.");
assert.ok(
  shipping.includes("standardEnvelopeRateForEstimatedOunces"),
  "Shipping policy must calculate current Standard Envelope rates from checkout code.",
);
assert.ok(
  shipping.includes("STANDARD_ENVELOPE_MAX_SUBTOTAL"),
  "Shipping policy must use the checkout envelope subtotal limit.",
);

const privacy = read("src/app/privacy/page.tsx");
assert.ok(privacy.includes("Payments are processed by Stripe"), "Privacy policy must explain payment processing.");
assert.ok(privacy.includes("do not sell customer personal information"), "Privacy policy must state the advertising-data position.");
assert.ok(privacy.includes("STORE_SUPPORT_EMAIL"), "Privacy policy must provide a contact method.");

const returnsPolicy = read("src/app/returns/page.tsx");
assert.ok(returnsPolicy.includes("Do not mail an item back"), "Returns must require authorization before shipment.");
assert.ok(returnsPolicy.includes("original payment method"), "Returns must explain the refund destination.");
assert.ok(returnsPolicy.includes("STORE_SUPPORT_EMAIL"), "Returns must provide a support contact.");

const contact = read("src/app/contact/page.tsx");
assert.ok(contact.includes("STORE_SUPPORT_EMAIL"), "Contact page must use the central support email.");
assert.ok(contact.includes("Do not email full payment-card numbers"), "Contact page must warn customers not to send sensitive credentials.");

const sitemap = read("src/app/sitemap.ts");
for (const token of [
  "TERMS_OF_SERVICE_PATH",
  "PRIVACY_POLICY_PATH",
  "SHIPPING_POLICY_PATH",
  "RETURNS_POLICY_PATH",
  "CONTACT_PATH",
]) {
  assert.ok(sitemap.includes(token), `Sitemap must include ${token}.`);
}

console.log("Public trust policy simulations passed.");
