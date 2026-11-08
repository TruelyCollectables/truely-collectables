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
    name: "Ivan Demidov professional rookie cards",
    query:
      "Ivan Demidov professional NHL rookie RC Young Guns rookie parallel numbered autograph memorabilia raw graded misspelling mislabeled",
    sources: mandatorySources,
    filters: {
      professionalRookieOnly: true,
      youngGunsEligible: true,
      ordinaryNonRookieExcluded: true,
      exactIdentityRequired: true,
      frontBackImagesRequired: true,
      multiVariationSelectionRequired: true,
      hardenedInstaCompRequired: true,
      minimumNetRoiPercent: 20,
    },
    cadence: "hourly",
  },
  {
    name: "WNBA professional rookie Silver or better",
    query:
      "Caitlin Clark Paige Bueckers Dominique Malonga Sonia Citron Kiki Iriafen professional WNBA rookie Silver Prizm color numbered SSP case hit autograph memorabilia misspelling mislabeled",
    sources: mandatorySources,
    filters: {
      players: [
        "Caitlin Clark",
        "Paige Bueckers",
        "Dominique Malonga",
        "Sonia Citron",
        "Kiki Iriafen",
      ],
      professionalWnbaRookieOnly: true,
      ordinaryBaseExcluded: true,
      minimumTier: "Silver Prizm or equivalent",
      collegeNcaaBowmanUniversityDraftPicksExcluded: true,
      exactIdentityRequired: true,
      frontBackImagesRequired: true,
      multiVariationSelectionRequired: true,
      hardenedInstaCompRequired: true,
      minimumNetRoiPercent: 20,
    },
    cadence: "hourly",
  },
  {
    name: "Danny Norris WNBA rookie mislisting lane",
    query:
      "Danny Norris CollX Caitlin Clark Paige Bueckers Dominique Malonga Sonia Citron Kiki Iriafen WNBA rookie Silver color numbered autograph memorabilia misspelling mislabeled",
    sources: mandatorySources,
    filters: {
      sellerName: "Danny Norris",
      professionalWnbaRookieOnly: true,
      ordinaryBaseExcluded: true,
      minimumTier: "Silver Prizm or equivalent",
      collegeNcaaBowmanUniversityDraftPicksExcluded: true,
      sellerInventorySweep: true,
      exactIdentityRequired: true,
      frontBackImagesRequired: true,
      hardenedInstaCompRequired: true,
      minimumNetRoiPercent: 20,
    },
    cadence: "hourly",
  },
  {
    name: "2021-present true 1st Bowman prospects",
    query:
      "2021 2022 2023 2024 2025 2026 true 1st Bowman Chrome prospects refractor Sapphire color numbered autograph misspelling mislabeled",
    sources: mandatorySources,
    filters: {
      trueFirstBowmanOnly: true,
      issueYearMinimum: 2021,
      completePlayerChronologyRequired: true,
      authoritativeChecklistRequired: true,
      proofNoEarlierFirstBowmanRequired: true,
      frontBackImagesRequired: true,
      hardenedInstaCompRequired: true,
      minimumNetRoiPercent: 20,
      permanentFailureExample: "Franklin Arias 2025 Bowman Draft Chrome BDC-13 is not a 1st Bowman",
    },
    cadence: "hourly",
  },
  {
    name: "Signed prospect baseball opportunities",
    query:
      "baseball prospect signed baseball autograph official MLB MiLB Futures Game Spring Training raw PSA DNA JSA Beckett BAS authentication upside",
    sources: [
      ...mandatorySources,
      "MLB Auctions",
      "MiLB and team auctions",
      "Fanatics Authentic",
      "team stores",
      "autograph dealers",
      "estate and liquidation listings",
    ],
    filters: {
      activeAndStrongWatchProspectsOnly: true,
      rawSignaturesNeverCalledAuthentic: true,
      ballTypesSeparated: true,
      provenanceAndFraudReviewRequired: true,
      authenticationFailureRiskRequired: true,
      minimumNetRoiPercent: 20,
    },
    cadence: "hourly",
  },
];

for (const search of searches) {
  const existing = (await repository.listSavedSearches()).find(
    (entry) => entry.name === search.name,
  );
  await repository.upsertSavedSearch({ ...search, id: existing?.id });
  console.log(`Seeded: ${search.name}`);
}
