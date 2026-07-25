import assert from "node:assert/strict";
import {
  isExternalStripeConnectAccountId,
  isInternalPlatformStoreOwnerPayoutAccount,
} from "../src/lib/live-payment-launch";

const storeId = "00000000-0000-4000-8000-000000000001";
const validOwner = {
  provider_account_id: `platform_store_owner:${storeId}`,
  metadata: {
    settlement_mode: "platform_store_owner",
    connect_required: false,
    platform_stripe_account: true,
    provider_account_id_kind: "internal_platform_owner",
  },
};

assert.equal(
  isInternalPlatformStoreOwnerPayoutAccount(validOwner, storeId),
  true,
  "The explicit internal platform-owner settlement marker must bypass Connect onboarding.",
);

assert.equal(
  isInternalPlatformStoreOwnerPayoutAccount(
    { provider_account_id: `platform_store_owner:${storeId}`, metadata: {} },
    storeId,
  ),
  false,
  "A look-alike owner ID without the complete metadata proof must not bypass validation.",
);

assert.equal(
  isInternalPlatformStoreOwnerPayoutAccount(validOwner, "00000000-0000-4000-8000-000000000002"),
  false,
  "An owner marker for another store must not bypass validation.",
);

assert.equal(
  isExternalStripeConnectAccountId("acct_1AbCdEfGhIjKlMnO"),
  true,
  "Real Stripe Connect IDs must remain eligible for live Stripe verification.",
);
assert.equal(
  isExternalStripeConnectAccountId(`platform_store_owner:${storeId}`),
  false,
  "The internal owner marker is not an external Stripe Connect ID.",
);
assert.equal(
  isExternalStripeConnectAccountId("seller-row-123"),
  false,
  "Malformed external seller IDs must remain blocked.",
);

console.log("Live payment owner-marker simulations passed: 6/6");
