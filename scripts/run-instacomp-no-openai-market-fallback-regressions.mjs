import assert from "node:assert/strict";
import fs from "node:fs";

const exactMarketRoutes = [
  "src/app/api/account/seller/inventory/instacomp/route.ts",
  "src/app/api/instacomp/live-scan/route.ts",
  "src/app/api/instacomp/deal-hunter/evaluate/resilient-core.ts",
  "src/app/api/instacomp/deal-hunter/evaluate/multi-provider-core.ts",
];

for (const routePath of exactMarketRoutes) {
  const source = fs.readFileSync(routePath, "utf8");
  assert.equal(
    source.includes("getOpenAiExactEbayMarketProviders"),
    false,
    `${routePath} must not import or call the OpenAI web-market provider`,
  );
}

const kingmaker = fs.readFileSync(exactMarketRoutes[0], "utf8");
assert.equal(
  kingmaker.includes("shouldSearchOpenAiWeb"),
  false,
  "KINGMAKER InstaComp must not retain an OpenAI web fallback gate",
);
assert.match(
  kingmaker,
  /OpenAI Web fallback is disabled/,
  "KINGMAKER no-comp behavior should explicitly remain non-OpenAI",
);
assert.match(
  kingmaker,
  /openAiWebMarket:\s*null/,
  "KINGMAKER response metadata should record that OpenAI web market was not used",
);

console.log("InstaComp exact-market OpenAI fallback regression passed for all production routes.");
