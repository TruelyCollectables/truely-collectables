import assert from "node:assert/strict";
import fs from "node:fs";

const routePath = "src/app/api/account/seller/inventory/instacomp/route.ts";
const source = fs.readFileSync(routePath, "utf8");

assert.equal(
  source.includes("getOpenAiExactEbayMarketProviders"),
  false,
  "KINGMAKER InstaComp must not import or call the OpenAI web-market provider",
);
assert.equal(
  source.includes("shouldSearchOpenAiWeb"),
  false,
  "KINGMAKER InstaComp must not retain an OpenAI web fallback gate",
);
assert.match(
  source,
  /OpenAI Web fallback is disabled/,
  "no-comp behavior should explicitly remain local/non-OpenAI",
);
assert.match(
  source,
  /openAiWebMarket:\s*null/,
  "response metadata should record that OpenAI web market was not used",
);

console.log("KINGMAKER InstaComp OpenAI-market fallback regression passed.");
