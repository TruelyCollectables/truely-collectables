import assert from "node:assert/strict";

process.env.EBAY_ENVIRONMENT = "production";
process.env.EBAY_CLIENT_ID = "test-client-id";
process.env.EBAY_CLIENT_SECRET = "test-client-secret";
delete process.env.EBAY_BROWSE_ACCESS_TOKEN;
process.env.EBAY_BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";
process.env.EBAY_BROWSE_REFRESH_SKEW_MS = "300000";
process.env.EBAY_BROWSE_TIMEOUT_MS = "20000";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return new Response(
    JSON.stringify({
      access_token: calls.length === 1 ? "test-token-one" : "test-token-two",
      token_type: "Application Access Token",
      expires_in: 7200,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

const { ebayApplicationTokenService } = await import(
  "../connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs"
);

assert.equal(ebayApplicationTokenService.configured, true);
assert.equal(ebayApplicationTokenService.status().mode, "client_credentials");

const first = await ebayApplicationTokenService.getAccessToken();
const second = await ebayApplicationTokenService.getAccessToken();
assert.equal(first, "test-token-one");
assert.equal(second, "test-token-one");
assert.equal(calls.length, 1, "Fresh application token must be cached.");

const firstCall = calls[0];
assert.equal(
  firstCall.url,
  "https://api.ebay.com/identity/v1/oauth2/token",
);
assert.equal(firstCall.init.method, "POST");
assert.equal(
  firstCall.init.headers.Authorization,
  `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
);
const body = String(firstCall.init.body);
assert.match(body, /grant_type=client_credentials/);
assert.match(body, /scope=https%3A%2F%2Fapi\.ebay\.com%2Foauth%2Fapi_scope/);
assert.equal(ebayApplicationTokenService.status().cached, true);

 ebayApplicationTokenService.invalidate(first);
const refreshed = await ebayApplicationTokenService.getAccessToken();
assert.equal(refreshed, "test-token-two");
assert.equal(calls.length, 2, "Invalidated token must be minted again.");

console.log(
  "eBay Browse auto-token simulation passed: client-credentials request, Basic authentication, scope, cache reuse, early-refresh state, and invalidation/remint behavior are correct.",
);
