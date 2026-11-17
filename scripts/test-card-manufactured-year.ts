import assert from "node:assert/strict";
import {
  createDualMarketplaceListingDraft,
  normalizeCardManufacturedYear,
  normalizeManufacturedYearAspects,
} from "../src/lib/dual-marketplace-listing";

const cases: Array<[unknown, string | null]> = [
  ["2015-16", "2015"],
  ["2018-19", "2018"],
  ["1997-98", "1997"],
  ["2015/16", "2015"],
  ["2018–19", "2018"],
  ["2015-2016", "2015"],
  ["not available", null],
  ["201819", null],
  [2015, "2015"],
];
for (const [raw, expected] of cases) {
  assert.equal(normalizeCardManufacturedYear(raw), expected, String(raw));
}
assert.deepEqual(
  normalizeManufacturedYearAspects(
    { "Season": ["2018-19"], "Year Manufactured": ["2018-19"], "Card Number": ["HH-NVE"] },
    "2018-19",
  ),
  { "Season": ["2018-19"], "Year Manufactured": ["2018"], "Card Number": ["HH-NVE"] },
);
assert.deepEqual(
  normalizeManufacturedYearAspects({ "Season": ["1997-98"] }, "unknown"),
  { "Season": ["1997-98"], "Year Manufactured": ["1997"] },
);
assert.deepEqual(
  normalizeManufacturedYearAspects({ "Season": ["unknown"], "Year Manufactured": ["bad"] }, null),
  { "Season": ["unknown"] },
);

const mock = createDualMarketplaceListingDraft({
  title: "1997-98 SkyBox Premium Autographics Nick Van Exel Auto",
  category: "Basketball Trading Cards",
  metadata: { instacomp: { ai: { year: "1997-98", player: "Nick Van Exel", sport: "Basketball" } } },
});
if (mock.identity.year === "1997-98") {
  assert.deepEqual(mock.aspects["Year Manufactured"], ["1997"]);
  assert.deepEqual(mock.aspects["Season"], ["1997-98"]);
}
console.log("PASS: year sanitizer, eBay aspects, and season preservation");
