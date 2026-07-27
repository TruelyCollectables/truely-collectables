import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const auth = fs.readFileSync("src/lib/account-auth.ts", "utf8");
for (const contract of [
  "getAuthenticatedAccountWithStoreRoleFromRequest",
  "getAuthenticatedSellerAccountFromRequest",
  '.from("account_store_memberships")',
  '.eq("account_id", account.id)',
  '.eq("store_id", getActiveStoreId())',
  '.eq("role", params.role)',
  'data.status !== (params.status || "active")',
]) {
  assert.ok(auth.includes(contract), `Seller membership verification is missing ${contract}.`);
}

const roleHelperStart = auth.indexOf(
  "export async function getAuthenticatedAccountWithStoreRoleFromRequest",
);
const roleHelperEnd = auth.indexOf(
  "export async function getAuthenticatedSellerAccountFromRequest",
  roleHelperStart,
);
const roleHelper = auth.slice(roleHelperStart, roleHelperEnd);
assert.doesNotMatch(
  roleHelper,
  /\.upsert\(|\.insert\(|\.update\(/,
  "Seller authentication must verify membership without creating or activating it.",
);

function filesUnder(root: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...filesUnder(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(full);
  }
  return results;
}

const payoutOnboarding = "src/app/api/account/seller/payout-onboarding/route.ts";
for (const filename of filesUnder("src/app/api/account/seller")) {
  const source = fs.readFileSync(filename, "utf8");
  if (filename === payoutOnboarding) {
    assert.ok(
      source.includes("getAuthenticatedAccountFromRequest"),
      "Explicit seller payout onboarding must remain available to authenticated buyers.",
    );
    continue;
  }
  assert.doesNotMatch(
    source,
    /getAuthenticatedAccountFromRequest/,
    `${filename} must not bypass active seller membership verification.`,
  );
}

for (const filename of filesUnder("src/lib").filter((name) =>
  path.basename(name).startsWith("active-market-"),
)) {
  const source = fs.readFileSync(filename, "utf8");
  assert.doesNotMatch(
    source,
    /getAuthenticatedAccountFromRequest/,
    `${filename} must not grant seller access from buyer authentication alone.`,
  );
}

const sellerPayouts = fs.readFileSync("src/lib/seller-payouts.ts", "utf8");
assert.ok(
  sellerPayouts.includes('role: "seller"') &&
    sellerPayouts.includes('payload.onboarding_status === "active"'),
  "Stripe payout verification must remain the explicit non-owner seller membership grant path.",
);

console.log(
  "Seller membership authorization simulations passed: seller APIs require an existing active seller role, while explicit payout onboarding remains the only buyer-to-seller grant path.",
);
