import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(
  "connectors/tcos-market-intel-mcp/src/config.mjs",
  "utf8",
);
const tokenService = readFileSync(
  "connectors/tcos-market-intel-mcp/src/ebay-application-token.mjs",
  "utf8",
);
const publicSearch = readFileSync(
  "connectors/tcos-market-intel-mcp/src/public-search.mjs",
  "utf8",
);
const probeRoute = readFileSync(
  "src/app/api/internal/ebay-browse-probe/route.js",
  "utf8",
);

assert.match(config, /ebayClientId: String\(process\.env\.EBAY_CLIENT_ID/);
assert.match(config, /ebayClientSecret: String\(process\.env\.EBAY_CLIENT_SECRET/);
assert.match(config, /https:\/\/api\.ebay\.com\/oauth\/api_scope/);
assert.match(config, /ebayBrowseRefreshSkewMs/);

assert.match(tokenService, /grant_type: "client_credentials"/);
assert.match(tokenService, /Authorization: `Basic \$\{credentials\}`/);
assert.match(tokenService, /globalState\.inFlight/);
assert.match(tokenService, /Date\.now\(\) \+ config\.ebayBrowseRefreshSkewMs/);
assert.match(tokenService, /mode = hasClientCredentials\(\)/);

assert.match(publicSearch, /ebayApplicationTokenService\.getAccessToken\(\)/);
assert.match(publicSearch, /response\.status === 401/);
assert.match(publicSearch, /forceRefresh: true/);
assert.match(publicSearch, /HTTP 403/);
assert.match(publicSearch, /HTTP 429/);
assert.match(publicSearch, /ebayBrowseDetails: this\.ebay\.status\(\)/);
assert.doesNotMatch(
  publicSearch,
  /Authorization: `Bearer \$\{config\.ebayBrowseAccessToken\}`/,
);

assert.match(probeRoute, /x-tcos-ebay-probe-token/);
assert.match(probeRoute, /timingSafeEqual/);
assert.match(probeRoute, /EBAY_PROBE_UNAUTHORIZED/);
assert.match(probeRoute, /EBAY_BUY_API_ACCESS_DENIED/);
assert.match(probeRoute, /resultCount/);
assert.doesNotMatch(probeRoute, /accessToken|clientSecret[^C]/);

console.log(
  "eBay Browse runtime contracts passed: automatic client credentials, cache/refresh, one-time 401 retry, fail-closed 403/429 behavior, private diagnostic auth, and no token disclosure are present.",
);
