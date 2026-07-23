import { assertProductionConfig } from "./config.mjs";
import { createRepository } from "./repository.mjs";

assertProductionConfig();
const repository = createRepository();

const mandatorySources = [
  "eBay",
  "Mercari",
  "Whatnot Marketplace",
  "Sportslots.com",
  "COMC",
  "MySlabs",
  "Fanatics Collect",
  "CollX",
  "Facebook Marketplace",
  "public Facebook groups/pages",
  "public X posts",
  "Etsy",
];

const searches = [
  {
    name: "Ivan Demidov full catalog",
    query:
      "Ivan Demidov hockey cards rookies inserts parallels variations autographs memorabilia numbered raw graded lots misspellings",
    sources: mandatorySources,
    filters: {
      ordinaryBaseExcluded: true,
      exactIdentityRequired: true,
      multiVariationSelectionRequired: true,
      minimumSingleNetProfit: 15,
      minimumLotNetProfit: 25,
    },
    cadence: "hourly",
  },
  {
    name: "WNBA watchlist and color lots",
    query:
      "Caitlin Clark Paige Bueckers Dominique Malonga Angel Reese Cameron Brink Kamilla Cardoso Sonia Citron Kiki Iriafen Rickea Jackson Kate Martin WNBA Prizm Select color lots",
    sources: mandatorySources,
    filters: {
      years: [2024, 2025],
      ordinaryBaseExcluded: true,
      courtsideBaseAllowed: true,
      silverAlwaysEligible: true,
      exactIdentityRequired: true,
      minimumSingleNetProfit: 15,
      minimumLotNetProfit: 25,
    },
    cadence: "hourly",
  },
  {
    name: "2024-2025 WNBA Logo Prizms",
    query:
      "2024 2025 Panini Prizm WNBA Logo Prizm refractor parallel cards lots misspellings under comps",
    sources: mandatorySources,
    filters: {
      exactParallel: "WNBA Logo Prizm",
      exactPhotoMatchRequired: true,
      multiVariationSelectionRequired: true,
      minimumRoiPercent: 10,
    },
    cadence: "hourly",
  },
  {
    name: "2021-present 1st Bowman prospects",
    query:
      "2021 2022 2023 2024 2025 2026 true 1st Bowman Chrome prospects refractors Mojo Sapphire color autos lots misspellings",
    sources: mandatorySources,
    filters: {
      trueFirstBowmanOnly: true,
      chromeBaseLotsAllowed: true,
      paperBaseNormallyFiller: true,
      minimumSingleNetProfit: 15,
      minimumLotNetProfit: 25,
    },
    cadence: "hourly",
  },
  {
    name: "Public Facebook and X collection liquidations",
    query:
      "sports card collection below comps priced to sell need gone moving sale collection liquidation take the lot fire sale claim sale Denver Parker Colorado",
    sources: ["Facebook Marketplace", "public Facebook groups/pages", "public X posts"],
    filters: {
      publicOrAuthorizedOnly: true,
      localAreas: ["Denver", "Parker", "Colorado"],
      sellerRiskReviewRequired: true,
      travelCostRequiredForPickup: true,
      buyerProtectedPaymentRequiredForShipping: true,
    },
    cadence: "hourly",
  },
];

for (const search of searches) {
  const existing = (await repository.listSavedSearches()).find((entry) => entry.name === search.name);
  await repository.upsertSavedSearch({ ...search, id: existing?.id });
  console.log(`Seeded: ${search.name}`);
}
