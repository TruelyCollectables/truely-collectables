import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync("src/app/admin/instacomp/pricing/_components/pricing-workbench.tsx", "utf8");
const pages = ["receipts", "analytics", "profiles", "review", "views", "audit"]
  .map((name) => fs.readFileSync(`src/app/admin/instacomp/pricing/${name}/page.tsx`, "utf8"))
  .join("\n");

for (const mode of ["receipts", "analytics", "profiles", "review", "views", "audit"]) {
  assert.match(pages, new RegExp(`mode=\\"${mode}\\"`));
}

assert.match(component, /\/api\/instacomp\/pricing\/command-center/);
assert.match(component, /credentials: "same-origin"/);
assert.match(component, /Advisory only/);
assert.match(component, /Owner scoped/);
assert.match(component, /No hidden mutations/);
assert.match(component, /reviewRequired/);
assert.match(component, /insufficientEvidence/);
assert.match(component, /averageConfidence/);
assert.match(component, /estimatedProfitAtCeiling/);
assert.match(component, /snapshot\.audit/);
assert.doesNotMatch(component + pages, /store_id|seller_account_id/);
assert.doesNotMatch(component + pages, /from\(["'](?:products|orders|offers|market_intel_purchases)["']\)/);

console.log("KINGMAKER Pricing workbench regressions passed.");
