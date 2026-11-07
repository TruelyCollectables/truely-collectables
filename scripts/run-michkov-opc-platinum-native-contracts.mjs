import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  "src/app/api/tcos/deal-hunter-michkov-opc-platinum/route.js",
  "utf8",
);

const familyIds = [
  "exact-o-pee-chee-rainbow",
  "opc-rainbow",
  "o-pee-chee-no-punctuation",
  "color-numbered-parallels",
  "rookie-autographs",
  "matvey-first-name",
  "matei-first-name",
  "michov-surname",
  "mikhkov-surname",
  "mitchkov-surname",
];

for (const familyId of familyIds) {
  assert.match(route, new RegExp(`matvei-michkov-opc-platinum\\.${familyId}`));
}

assert.equal(
  (route.match(/familyId: "matvei-michkov-opc-platinum\./g) || []).length,
  10,
);
assert.match(route, /scope: "matvei_michkov_opc_platinum"/);
assert.match(route, /minimumEligibleTier: "Rainbow"/);
assert.match(route, /ordinaryBaseExcluded: true/);
assert.match(route, /EXPLICIT_BASE\.test\(value\) && !RAINBOW_OR_BETTER\.test\(value\)/);
assert.match(route, /rainbow_or_better_not_proven_from_title_verify_images/);
assert.match(route, /seller_name_variant_or_misspelling_detected_verify_images/);
assert.match(route, /custom_reprint_digital_break_mystery_or_checklist/);
assert.match(route, /requiredMichkovOpcPlatinumFamilyCount: 10/);
assert.match(route, /requiredMichkovOpcPlatinumFamiliesExecuted/);
assert.match(route, /tokenMode: "client_credentials"/);
assert.match(route, /exactCompAndTwentyPercentNetRoiRequired: true/);
assert.match(route, /purchaseCapability: false/);
assert.match(route, /ledgerMutationCapability: false/);
assert.doesNotMatch(route, /checkout|buyNow|purchaseItem|recordPurchase/);

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "TCOS_NATIVE_EBAY_FEED_V1",
      scope: "matvei_michkov_opc_platinum",
      queryFamilies: familyIds.length,
      ordinaryBaseExcluded: true,
      minimumEligibleTier: "Rainbow",
      exactCompAndTwentyPercentNetRoiRequired: true,
      purchaseCapability: false,
    },
    null,
    2,
  ),
);
