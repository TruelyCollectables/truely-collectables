import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  isInternalPlatformStoreOwnerPayoutAccount(
    validOwner,
    "00000000-0000-4000-8000-000000000002",
  ),
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

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260726020000_enforce_platform_owner_payout_marker.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

assert.match(
  migration,
  /update\s+public\.seller_payout_accounts/i,
  "The migration must backfill the seller payout account table.",
);
assert.match(
  migration,
  /where\s+provider\s*=\s*'stripe_connect'/i,
  "The backfill must stay scoped to Stripe Connect payout rows.",
);
assert.match(
  migration,
  /provider_account_id\s*=\s*'platform_store_owner:'\s*\|\|\s*store_id::text/i,
  "The backfill must target only store-scoped internal owner IDs.",
);
assert.match(
  migration,
  /'settlement_mode'\s*,\s*'platform_store_owner'/i,
  "The migration must persist the platform owner settlement mode.",
);
assert.match(
  migration,
  /'connect_required'\s*,\s*false/i,
  "The migration must mark Connect onboarding as unnecessary.",
);
assert.match(
  migration,
  /'platform_stripe_account'\s*,\s*true/i,
  "The migration must identify the platform Stripe account.",
);
assert.match(
  migration,
  /'provider_account_id_kind'\s*,\s*'internal_platform_owner'/i,
  "The migration must persist the internal provider-ID kind.",
);
assert.match(
  migration,
  /add\s+constraint\s+seller_payout_accounts_internal_owner_contract_check/i,
  "The migration must prevent incomplete internal owner markers from returning.",
);
assert.match(
  migration,
  /validate\s+constraint\s+seller_payout_accounts_internal_owner_contract_check/i,
  "The internal owner constraint must be validated before the migration commits.",
);
assert.doesNotMatch(
  migration,
  /delete\s+from\s+public\.seller_payout_accounts/i,
  "The repair must never delete payout account rows.",
);

console.log("Live payment owner-marker simulations passed: 16/16");
