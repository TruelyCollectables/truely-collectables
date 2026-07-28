import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(
  "src/lib/tcos-profit-hunter-action-service.mjs",
  "utf8",
);
const http = readFileSync(
  "src/lib/tcos-profit-hunter-action-http.mjs",
  "utf8",
);
const status = readFileSync(
  "src/app/api/tcos-profit-hunter/actions/status/route.js",
  "utf8",
);
const search = readFileSync(
  "src/app/api/tcos-profit-hunter/actions/search/route.js",
  "utf8",
);
const verify = readFileSync(
  "src/app/api/tcos-profit-hunter/actions/verify/route.js",
  "utf8",
);
const openapiSource = readFileSync(
  "src/app/api/tcos-profit-hunter/actions/openapi/route.js",
  "utf8",
);

assert.match(http, /validateProfitHunterServiceBearer/);
assert.match(http, /WWW-Authenticate": "Bearer"/);
assert.match(http, /Content-Type must be application\/json/);
assert.match(status, /authorizeProfitHunterAction/);
assert.match(search, /authorizeProfitHunterAction/);
assert.match(verify, /authorizeProfitHunterAction/);

assert.match(service, /Ivan Demidov/);
assert.match(service, /TCOS_WNBA_ROOKIE_PLAYERS/);
assert.match(service, /ordinaryBaseExcluded: true/);
assert.match(service, /collegeNcaaBowmanUniversityDraftPicksExcluded: true/);
assert.match(service, /trueFirstBowmanOnly: true/);
assert.match(service, /checkProfitHunterOwnedPurchase/);
assert.match(service, /hardenedInstaCompService\.scanListing/);
assert.match(service, /pricingEligibleSoldCount/);
assert.match(service, /targetRoi: 0\.2/);
assert.match(service, /purchaseReady: false/);
assert.doesNotMatch(service, /recordPurchase|purchaseItem|checkout|buyNow/i);

assert.match(openapiSource, /openapi: "3\.0\.3"/);
assert.match(openapiSource, /scheme: "bearer"/);
assert.match(openapiSource, /operationId: "getProfitHunterStatus"/);
assert.match(openapiSource, /operationId: "searchProfitHunterCandidates"/);
assert.match(openapiSource, /operationId: "verifyProfitHunterListing"/);
assert.match(openapiSource, /"x-openai-isConsequential": false/g);
assert.match(
  openapiSource,
  /https:\/\/truelycollectables\.com\/api\/tcos-profit-hunter\/actions/,
);
assert.match(openapiSource, /It never purchases items/);

console.log(
  "TCOS Profit Hunter GPT Actions passed: bearer authentication, locked lanes, owned-copy exclusion, hardened InstaComp verification, exact-sold pricing, 20% ROI floor, no purchase operations, and paste-ready OpenAPI operation IDs are present.",
);
