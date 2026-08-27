import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getStripeLivePublishableKey,
  getStripeLiveSecretKey,
  getStripeLiveWebhookSecret,
  getStripeTestPublishableKey,
  getStripeTestSecretKey,
  getStripeTestWebhookSecret,
} from "../src/lib/stripe-credentials";

const credentialNames = [
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_TEST_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY",
  "STRIPE_TEST_WEBHOOK_SECRET",
] as const;

const originalEnvironment = Object.fromEntries(
  credentialNames.map((name) => [name, process.env[name]]),
);

function clearCredentials() {
  for (const name of credentialNames) delete process.env[name];
}

try {
  clearCredentials();
  process.env.STRIPE_SECRET_KEY = "sk_live_generic_must_not_be_used";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY =
    "pk_live_generic_must_not_be_used";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_generic_must_not_be_used";

  assert.equal(
    getStripeLiveSecretKey(),
    null,
    "Generic STRIPE_SECRET_KEY must not satisfy live Checkout.",
  );
  assert.equal(
    getStripeLivePublishableKey(),
    null,
    "Generic publishable key must not satisfy live Checkout.",
  );
  assert.equal(
    getStripeLiveWebhookSecret(),
    null,
    "Generic webhook secret must not satisfy the live endpoint.",
  );

  process.env.STRIPE_LIVE_SECRET_KEY = "sk_live_dedicated_credential";
  process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY =
    "pk_live_dedicated_credential";
  process.env.STRIPE_LIVE_WEBHOOK_SECRET = "whsec_dedicated_credential";

  assert.equal(
    getStripeLiveSecretKey(),
    "sk_live_dedicated_credential",
    "Dedicated live secret key should be accepted.",
  );
  assert.equal(
    getStripeLivePublishableKey(),
    "pk_live_dedicated_credential",
    "Dedicated live publishable key should be accepted.",
  );
  assert.equal(
    getStripeLiveWebhookSecret(),
    "whsec_dedicated_credential",
    "Dedicated live webhook secret should be accepted.",
  );

  clearCredentials();
  process.env.STRIPE_SECRET_KEY = "sk_test_generic_compatibility";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY =
    "pk_test_generic_compatibility";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_generic_compatibility";

  assert.equal(
    getStripeTestSecretKey(),
    "sk_test_generic_compatibility",
    "Generic test secret compatibility should remain available.",
  );
  assert.equal(
    getStripeTestPublishableKey(),
    "pk_test_generic_compatibility",
    "Generic test publishable compatibility should remain available.",
  );
  assert.equal(
    getStripeTestWebhookSecret(),
    "whsec_test_generic_compatibility",
    "Generic test webhook compatibility should remain available when the generic secret is test mode.",
  );

  const statusSource = fs.readFileSync(
    path.join(process.cwd(), "scripts/status-live-money.ts"),
    "utf8",
  );
  assert.ok(
    !statusSource.includes("configured via fallback"),
    "Live-money status must not report generic live credential fallback.",
  );
  for (const forbidden of [
    "process.env.STRIPE_SECRET_KEY,\n          \"sk_live_\"",
    "process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,\n          \"pk_live_\"",
    "process.env.STRIPE_WEBHOOK_SECRET,\n          \"whsec_\"",
  ]) {
    assert.ok(
      !statusSource.includes(forbidden),
      `Live-money status must not inspect generic live fallback: ${forbidden}`,
    );
  }

  const envPacketSource = fs.readFileSync(
    path.join(process.cwd(), "scripts/live-money-env-packet.mjs"),
    "utf8",
  );
  assert.ok(
    envPacketSource.includes(
      "This exact variable is required; generic Stripe variables are not accepted for live Checkout.",
    ),
    "The operator environment packet must explain the dedicated live-key requirement.",
  );

  const checkoutSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/checkout/route.ts"),
    "utf8",
  );
  assert.ok(
    checkoutSource.includes("getStripePaymentRuntime"),
    "Checkout must continue to use the gated Stripe runtime.",
  );

  const webhookSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/webhook/route.ts"),
    "utf8",
  );
  for (const helper of [
    "getStripeLiveSecretKey",
    "getStripeLiveWebhookSecret",
    "getStripeTestSecretKey",
    "getStripeTestWebhookSecret",
  ]) {
    assert.ok(
      webhookSource.includes(helper),
      `Webhook route must continue to use credential helper ${helper}.`,
    );
  }

  console.log(
    "Stripe live credential fail-closed simulations passed: live Checkout and webhooks require dedicated live variables while test-mode compatibility remains intact.",
  );
} finally {
  for (const name of credentialNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
