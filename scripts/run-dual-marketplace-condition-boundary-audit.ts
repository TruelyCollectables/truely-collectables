import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "src/lib/ebay-inventory-publisher-strict.ts",
  "utf8",
);
const exportSource = fs.readFileSync(
  "src/lib/ebay-inventory-publisher.ts",
  "utf8",
);

for (const allowed of [
  "Near Mint or Better",
  "Excellent",
  "Very Good",
  "Poor",
  "Lightly Played (Excellent)",
  "Moderately Played (Very Good)",
  "Heavily Played (Poor)",
]) {
  assert.ok(source.includes(`\"${allowed}\"`), `Missing exact allowed condition: ${allowed}`);
}

assert.doesNotMatch(
  source,
  /^\s*\"Good\",?\s*$/m,
  "Generic Good must never be accepted because fuzzy eBay matching can overstate it as Very Good.",
);
assert.match(
  source,
  /allowed\.has\(String\(params\.item\.cardCondition/,
  "The final publisher must enforce exact membership, not fuzzy matching.",
);
assert.match(
  exportSource,
  /ebay-inventory-publisher-strict/,
  "All production imports must pass through the exact-condition publisher guard.",
);

console.log("Dual-marketplace exact condition boundary audit passed.");
