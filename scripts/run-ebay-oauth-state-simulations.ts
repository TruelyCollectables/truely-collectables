import assert from "node:assert/strict";
import fs from "node:fs";
import { readEbayAuthorizationCode } from "../src/lib/ebay-oauth-code";
import {
  createAdminMarketplaceOAuthState,
  createSellerMarketplaceOAuthState,
  parseAdminMarketplaceOAuthState,
  parseSellerMarketplaceOAuthState,
} from "../src/lib/marketplace-token-crypto";

process.env.MARKETPLACE_OAUTH_STATE_SECRET =
  "build-only-marketplace-oauth-state-secret-with-sufficient-entropy";

const sellerStateValue = createSellerMarketplaceOAuthState({
  accountId: "seller-account-123",
  storeId: "store-123",
  provider: "ebay",
});
const sellerState = parseSellerMarketplaceOAuthState(sellerStateValue);
assert.equal(sellerState.accountId, "seller-account-123");
assert.equal(sellerState.storeId, "store-123");
assert.equal(sellerState.provider, "ebay");
assert.ok(sellerState.expiresAt > sellerState.issuedAt);

const adminStateValue = createAdminMarketplaceOAuthState({
  storeId: "store-123",
  provider: "ebay",
});
const adminState = parseAdminMarketplaceOAuthState(adminStateValue);
assert.equal(adminState.actor, "admin");
assert.equal(adminState.storeId, "store-123");
assert.equal(adminState.provider, "ebay");
assert.ok(adminState.expiresAt > adminState.issuedAt);

assert.throws(
  () => parseAdminMarketplaceOAuthState(sellerStateValue),
  /Admin OAuth state payload is invalid/,
);
assert.throws(
  () => parseSellerMarketplaceOAuthState(adminStateValue),
  /Seller OAuth state payload is invalid/,
);

const [payload, signature] = adminStateValue.split(".");
assert.ok(payload && signature, "Admin OAuth state must contain payload and signature.");
const replacement = signature.startsWith("A") ? "B" : "A";
const tamperedState = `${payload}.${replacement}${signature.slice(1)}`;
assert.throws(
  () => parseAdminMarketplaceOAuthState(tamperedState),
  /OAuth state signature mismatch/,
);
assert.throws(
  () => parseAdminMarketplaceOAuthState(""),
  /Missing or invalid OAuth state/,
);

const adminAuthRoute = fs.readFileSync("src/app/api/ebay/auth/route.ts", "utf8");
const callbackRoute = fs.readFileSync(
  "src/app/api/ebay/callback/route.ts",
  "utf8",
);

assert.match(
  adminAuthRoute,
  /createAdminMarketplaceOAuthState\s*\(\{[\s\S]*storeId,[\s\S]*provider:\s*"ebay"/,
);
assert.match(
  adminAuthRoute,
  /&state=\$\{encodeURIComponent\(state\)\}/,
);

const missingStateGuardIndex = callbackRoute.indexOf("if (!state)");
const actorParseIndex = callbackRoute.indexOf("parseOAuthActor(state, storeId)");
const tokenExchangeIndex = callbackRoute.indexOf(
  'exchangeEbayAuthorizationCode({',
);

assert.ok(missingStateGuardIndex >= 0, "Callback must reject missing OAuth state.");
assert.ok(actorParseIndex > missingStateGuardIndex, "Callback must parse signed state after checking presence.");
assert.ok(tokenExchangeIndex > actorParseIndex, "Callback must validate signed state before exchanging the code.");
assert.match(callbackRoute, /mode:\s*"oauth_exchange"/);
assert.match(callbackRoute, /postInstaCompMacAccounting/);
assert.doesNotMatch(callbackRoute, /\.from\("ebay_tokens"\)\.insert/);
assert.doesNotMatch(callbackRoute, /encryptMarketplaceToken/);
assert.match(callbackRoute, /data\.tokenStored !== true/);
assert.match(callbackRoute, /mac_local:TCOS-Current-Review\/ebay-seller-token\.json/);
assert.match(callbackRoute, /preserveExistingSellerConnectionAfterOAuthFailure/);
assert.match(callbackRoute, /sellerState\.storeId !== activeStoreId/);
assert.match(callbackRoute, /adminState\.storeId !== activeStoreId/);
assert.match(callbackRoute, /store_id:\s*actor\.state\.storeId/);


assert.equal(
  readEbayAuthorizationCode("https://truelycollectables.com/api/ebay/callback?state=dummy&code=v%5E1.1%23abc%2Bdef"),
  "v^1.1#abc+def",
);
assert.equal(
  readEbayAuthorizationCode("https://truelycollectables.com/api/ebay/callback?code=v%5E1%23abc+def"),
  "v^1#abc+def",
);
assert.equal(readEbayAuthorizationCode("https://truelycollectables.com/api/ebay/callback?code=%ZZ"), null);
assert.equal(readEbayAuthorizationCode("https://truelycollectables.com/api/ebay/callback?code="), null);
assert.equal(readEbayAuthorizationCode("https://truelycollectables.com/api/ebay/callback?state=abc"), null);
assert.match(callbackRoute, /readEbayAuthorizationCode\(request\.url\)/);

const connectionTestRoute = fs.readFileSync("src/app/api/ebay/test/route.ts", "utf8");
assert.match(connectionTestRoute, /grant_type: "client_credentials"/);
assert.match(connectionTestRoute, /applicationAuthenticated: authenticated/);
assert.doesNotMatch(connectionTestRoute, /test route works/);

console.log("eBay OAuth state security simulations passed: signed state, Mac-local exchange ordering, no cloud token storage, and reconnect preservation verified");
