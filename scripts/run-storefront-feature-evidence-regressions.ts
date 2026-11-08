import assert from "node:assert/strict";
import {
  deriveStrictStorefrontFeatures,
  hasStrictAutographTitleEvidence,
  hasStrictGradedTitleEvidence,
  hasStrictMemorabiliaTitleEvidence,
  hasStrictNumberedTitleEvidence,
  hasStrictRookieTitleEvidence,
} from "../src/lib/storefront-feature-evidence.ts";

const autographTrue = [
  "2023-24 Credentials #DTAA-MK Marco Kasper Debut Ticket Access Auto /199",
  "2024-25 SP Authentic Danil Gushchin Retro Autographed Future Watch /699",
  "2013-14 Panini Timeless Treasures Nick Van Exel Treasured Ink /15",
  "2015 Topps Museum Henderson Alvarez Momentous Material Autos /10",
  "Michael Jordan Signed Basketball Upper Deck Authenticated",
];
for (const title of autographTrue) {
  assert.equal(hasStrictAutographTitleEvidence(title), true, title);
}

const autographFalse = [
  "2024 Bowman Chrome Refractor Non Auto",
  "2023-24 Upper Deck Connor Bedard Rookie unsigned",
  "NASCAR Auto Racing Kasey Kahne Prizm",
  "Facsimile Signature Reprint Card",
  "PSA DNA Authentication Card Holder",
  "2024 Topps Chrome Base Refractor",
];
for (const title of autographFalse) {
  assert.equal(hasStrictAutographTitleEvidence(title), false, title);
}

assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2023-24 SP Game Used Nathan MacKinnon Jersey Card",
  ),
  true,
);
assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2024-25 Upper Deck Premier #23 Mason McTavish Bronze Jersey",
  ),
  true,
);
assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2024-25 SkyBox Metal Universe Connor McDavid Microfibers",
  ),
  true,
);
assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2025-26 SP Game Used #NM-89 Peter Forsberg NHL Masters #/299",
  ),
  false,
);
assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2024-25 Upper Deck New Jersey Devils Team Checklist",
  ),
  false,
);
assert.equal(
  hasStrictMemorabiliaTitleEvidence(
    "2007 Upper Deck Premier Maurice Jones-Drew Stitchings /75",
  ),
  true,
);

assert.equal(hasStrictRookieTitleEvidence("2024 Bowman Chrome RC #12"), true);
assert.equal(hasStrictRookieTitleEvidence("2024 Bowman Chrome #RC-12"), true);
assert.equal(hasStrictRookieTitleEvidence("2024 Bowman Chrome Veteran #12"), false);
assert.equal(hasStrictRookieTitleEvidence("2024 Upper Deck Young Guns"), true);

assert.equal(hasStrictGradedTitleEvidence("2024 Topps PSA 10"), true);
assert.equal(hasStrictGradedTitleEvidence("2024 Topps SGC 9.5"), true);
assert.equal(
  hasStrictGradedTitleEvidence("PSA DNA Autograph Authentication Only"),
  false,
);
assert.equal(hasStrictGradedTitleEvidence("2024 Topps Raw Card"), false);

assert.equal(
  hasStrictNumberedTitleEvidence("2024 Prizm Orange /99", "NBA"),
  true,
);
assert.equal(
  hasStrictNumberedTitleEvidence("2024 Prizm Orange 12/99", "NBA"),
  true,
);
assert.equal(
  hasStrictNumberedTitleEvidence("2013 Topps Vault Blank Back 1/1", "Baseball"),
  true,
);
assert.equal(
  hasStrictNumberedTitleEvidence("2023/24 Upper Deck Base", "Hockey"),
  false,
);
assert.equal(
  hasStrictNumberedTitleEvidence("ME05 #001/084 Tropius", "Trading Card Games"),
  false,
);

assert.deepEqual(
  deriveStrictStorefrontFeatures({
    title: "2024 Bowman Chrome Rookie Auto Patch PSA 10 12/25",
    section: "Baseball",
  }),
  {
    autograph: true,
    memorabilia: true,
    rookie: true,
    graded: true,
    numbered: true,
  },
);

assert.deepEqual(
  deriveStrictStorefrontFeatures({
    title: "Michael Jordan Autographed Official NBA Basketball",
    section: "Balls",
  }),
  {
    autograph: true,
    memorabilia: false,
    rookie: false,
    graded: false,
    numbered: false,
  },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      autographFalsePositiveGuards: autographFalse.length,
      autographPositiveCases: autographTrue.length,
      allFeatureCategoriesCovered: true,
      seasonFractionExcluded: true,
      oneOfOneIncluded: true,
      spGameUsedSetNameExcludedFromMemorabilia: true,
      newJerseyFalsePositiveExcluded: true,
      psaDnaOnlyExcludedFromGraded: true,
    },
    null,
    2,
  ),
);
