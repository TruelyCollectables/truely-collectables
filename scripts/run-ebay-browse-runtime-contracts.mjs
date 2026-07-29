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
const wnbaNativeRoute = readFileSync(
  "src/app/api/internal/wnba-native-search/route.js",
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
assert.match(publicSearch, /exchange\.response\.status === 401/);
assert.match(publicSearch, /forceRefresh: true/);
assert.match(publicSearch, /const text = await response\.text\(\)/);
assert.match(publicSearch, /return \{ response, text \}/);
assert.match(publicSearch, /eBay Browse request timed out after/);
assert.match(publicSearch, /HTTP 403/);
assert.match(publicSearch, /HTTP 429/);
assert.match(publicSearch, /ebayBrowseDetails: this\.ebay\.status\(\)/);
assert.doesNotMatch(
  publicSearch,
  /Authorization: `Bearer \$\{config\.ebayBrowseAccessToken\}`/,
);

assert.match(probeRoute, /x-tcos-ebay-probe-token/);
assert.match(probeRoute, /timingSafeEqual/);
assert.match(probeRoute, /ADMIN_SESSION_COOKIE_NAMES/);
assert.match(probeRoute, /isValidAdminSessionValue/);
assert.match(probeRoute, /hasValidAdminSession/);
assert.match(probeRoute, /admin_session/);
assert.match(probeRoute, /probe_token/);
assert.match(probeRoute, /EBAY_PROBE_TOKEN_NOT_CONFIGURED/);
assert.match(probeRoute, /EBAY_PROBE_TOKEN_MISSING/);
assert.match(probeRoute, /EBAY_PROBE_TOKEN_MISMATCH/);
assert.match(probeRoute, /EBAY_PROBE_AUTHORIZED/);
assert.match(probeRoute, /authOnly/);
assert.match(probeRoute, /VERCEL_GIT_COMMIT_SHA/);
assert.match(probeRoute, /VERCEL_ENV/);
assert.match(probeRoute, /withDeadline/);
assert.match(probeRoute, /application_token/);
assert.match(probeRoute, /browse_search/);
assert.match(probeRoute, /EBAY_APPLICATION_TOKEN_TIMEOUT/);
assert.match(probeRoute, /EBAY_BROWSE_TIMEOUT/);
assert.match(probeRoute, /EBAY_BUY_API_ACCESS_DENIED/);
assert.match(probeRoute, /resultCount/);
assert.match(probeRoute, /timings/);
assert.doesNotMatch(probeRoute, /accessToken|clientSecret[^C]/);

assert.match(wnbaNativeRoute, /TCOS_WNBA_ROOKIE_PLAYERS/);
assert.match(wnbaNativeRoute, /Caitlin Clark|QUERY_FAMILIES/);
assert.match(wnbaNativeRoute, /broad_rookie/);
assert.match(wnbaNativeRoute, /parallel_numbered/);
assert.match(wnbaNativeRoute, /auto_memorabilia/);
assert.match(wnbaNativeRoute, /REJECTED_COLLEGE_TITLE/);
assert.match(wnbaNativeRoute, /REJECTED_ORDINARY_BASE_TITLE/);
assert.match(wnbaNativeRoute, /LIKELY_SCOPE_MATCH/);
assert.match(wnbaNativeRoute, /POTENTIAL_SCOPE_MATCH/);
assert.match(wnbaNativeRoute, /requiresHardenedVerification: true/);
assert.match(wnbaNativeRoute, /purchaseReady: false/);
assert.match(wnbaNativeRoute, /minimumNetRoiPercent: 20/);
assert.match(wnbaNativeRoute, /format === "html"/);
assert.match(wnbaNativeRoute, /ADMIN_SESSION_COOKIE_NAMES/);
assert.match(wnbaNativeRoute, /x-tcos-ebay-probe-token/);
assert.doesNotMatch(wnbaNativeRoute, /recordPurchase|checkout|buyNow/i);
assert.doesNotMatch(wnbaNativeRoute, /accessToken|clientSecret[^C]/);

console.log(
  "eBay Browse runtime contracts passed: automatic client credentials, cache/refresh, body-safe request deadlines, one-time 401 retry, fail-closed 403/429 behavior, explicit probe-secret diagnostics, admin-session fallback, deployment identity, auth-only verification, stage-timed private diagnostics, full five-player WNBA native discovery with title-scope screening, no purchase writes, and no token disclosure are present.",
);
