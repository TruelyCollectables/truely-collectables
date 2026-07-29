import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BUYER_ACCOUNT_ACTIVE_STATUS,
  BUYER_CARD_VERIFICATION_REQUIRED,
  BUYER_MEMBERSHIP_ACTIVE_STATUS,
  shouldActivateLegacyBuyerAccount,
} from "../src/lib/buyer-account-policy";

const read = (path: string) => fs.readFileSync(path, "utf8");
const signupPage = read("src/app/account/signup/page.tsx");
const loginPage = read("src/app/account/login/page.tsx");
const signupRoute = read("src/app/api/account/signup/route.ts");
const loginRoute = read("src/app/api/account/login/route.ts");
const accountAuth = read("src/lib/account-auth.ts");
const checkoutRoute = read("src/app/api/checkout/route.ts");
const webhookRoute = read("src/app/api/webhook/route.ts");

assert.equal(BUYER_CARD_VERIFICATION_REQUIRED, false);
assert.equal(BUYER_ACCOUNT_ACTIVE_STATUS, "active");
assert.equal(BUYER_MEMBERSHIP_ACTIVE_STATUS, "active");
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "payment_verification_required",
    defaultAccountType: "buyer",
  }),
  true,
);
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "payment_verification_required",
    defaultAccountType: "seller",
  }),
  false,
);
assert.equal(
  shouldActivateLegacyBuyerAccount({
    accountStatus: "active",
    defaultAccountType: "buyer",
  }),
  false,
);

assert.match(signupPage, /Truely Collectables Buyer Account/);
assert.match(signupPage, /No payment card is required to register/);
assert.match(signupPage, /Create Buyer Account/);
assert.doesNotMatch(signupPage, /Create Account And Verify Card/);
assert.doesNotMatch(signupPage, /cardVerificationUrl/);
assert.doesNotMatch(signupPage, /card_verification=canceled/);
assert.match(loginPage, /No card\s+verification is required/);
assert.doesNotMatch(loginPage, /Stripe confirms the card/);

assert.doesNotMatch(signupRoute, /from "stripe"/);
assert.doesNotMatch(signupRoute, /getStripePaymentRuntime/);
assert.doesNotMatch(signupRoute, /checkout\.sessions\.create/);
assert.doesNotMatch(signupRoute, /ACCOUNT_CARD_VERIFICATION_REQUIRED/);
assert.match(signupRoute, /accountStatus: BUYER_ACCOUNT_ACTIVE_STATUS/);
assert.match(signupRoute, /status: BUYER_MEMBERSHIP_ACTIVE_STATUS/);
assert.match(
  signupRoute,
  /cardVerificationRequired: BUYER_CARD_VERIFICATION_REQUIRED/,
);
assert.match(signupRoute, /session: data\.session/);

assert.match(loginRoute, /shouldActivateLegacyBuyerAccount/);
assert.match(loginRoute, /buyer_card_verification_requirement_removed/);
assert.match(
  loginRoute,
  /Seller verification must be completed through TCOS seller onboarding/,
);
assert.match(accountAuth, /shouldActivateLegacyBuyerAccount/);
assert.match(accountAuth, /status: BUYER_MEMBERSHIP_ACTIVE_STATUS/);

assert.match(
  checkoutRoute,
  /const account = await getAuthenticatedAccountFromRequest/,
);
assert.match(checkoutRoute, /accountId: account\?\.id \|\| null/);
assert.doesNotMatch(checkoutRoute, /payment_verification_required/);
assert.doesNotMatch(checkoutRoute, /card_verified/);

assert.match(webhookRoute, /seller_card_verification_setup/);
assert.match(webhookRoute, /role: "seller"/);
assert.match(webhookRoute, /buyer_card_verification_retired/);
assert.match(webhookRoute, /role: "buyer"[\s\S]*status: "active"/);
assert.match(webhookRoute, /evaluateAccountCardVerification/);

console.log(
  "Buyer account signup without card verification regressions passed.",
);
