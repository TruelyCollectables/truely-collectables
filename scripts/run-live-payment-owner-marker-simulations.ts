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

const sellerRows = [
  validOwner,
  { provider_account_id: "acct_1AbCdEfGhIjKlMnO", metadata: {} },
  { provider_account_id: "seller-row-123", metadata: {} },
];
const internalOwnerRows = sellerRows.filter((row) =>
  isInternalPlatformStoreOwnerPayoutAccount(row, storeId),
);
const externalRows = sellerRows.filter(
  (row) => !isInternalPlatformStoreOwnerPayoutAccount(row, storeId),
);
const externalAccountIds = externalRows
  .map((row) => row.provider_account_id)
  .filter(isExternalStripeConnectAccountId);
const invalidExternalRows = externalRows.filter(
  (row) => !isExternalStripeConnectAccountId(row.provider_account_id),
);

assert.deepEqual(
  internalOwnerRows.map((row) => row.provider_account_id),
  [`platform_store_owner:${storeId}`],
  "The repaired platform-owner row must be classified as internal.",
);
assert.deepEqual(
  externalAccountIds,
  ["acct_1AbCdEfGhIjKlMnO"],
  "Only genuine acct_ identifiers may be sent to Stripe for Connect verification.",
);
assert.equal(
  externalAccountIds.includes(`platform_store_owner:${storeId}`),
  false,
  "The platform-owner identifier must never be sent to Stripe as a Connect account.",
);
assert.equal(
  invalidExternalRows.length,
  1,
  "Malformed external payout rows must remain fail-closed.",
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

const corePath = path.join(
  process.cwd(),
  "src/lib/live-payment-launch-core.ts",
);
const core = fs.readFileSync(corePath, "utf8");

assert.match(
  core,
  /\.select\("provider_account_id,onboarding_status,payouts_enabled,details_submitted,disabled_reason,metadata"\)/,
  "The core launch check must retrieve metadata needed to prove the internal-owner contract.",
);
assert.match(
  core,
  /const internalOwnerRows = sellerRows\.filter\(\(row\) =>\s*isInternalPlatformStoreOwnerPayoutAccount\(row, storeId\)/s,
  "The core launch check must identify internal owner settlement rows.",
);
assert.match(
  core,
  /const externalRows = sellerRows\.filter\(\s*\(row\) => !isInternalPlatformStoreOwnerPayoutAccount\(row, storeId\)/s,
  "The core launch check must remove internal owner rows before external verification.",
);
assert.match(
  core,
  /externalRows\s*\.map\(\(row\) => row\.provider_account_id\)\s*\.filter\(isExternalStripeConnectAccountId\)/s,
  "Only validated external acct_ IDs may enter Stripe verification.",
);
assert.match(
  core,
  /externalAccountIds\.map\(async \(accountId\) =>[\s\S]*stripe\.accounts\.retrieve\(accountId\)/,
  "Stripe retrieval must iterate only over the validated external account list.",
);
assert.doesNotMatch(
  core,
  /const connectedSellerIds = sellerRows/,
  "The old all-rows Connect loop must not return.",
);
assert.doesNotMatch(
  core,
  /One or more stored seller accounts are not valid, submitted, and payout-enabled in live mode\./,
  "The ambiguous old blocker message must not return.",
);
assert.match(
  core,
  /internal platform-store-owner settlement record\(s\) correctly bypass Connect onboarding/,
  "The core launch check must emit explicit passing evidence for internal owner rows.",
);

console.log("Live payment owner-marker simulations passed.");
