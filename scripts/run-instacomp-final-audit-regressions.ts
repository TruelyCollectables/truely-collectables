import assert from "node:assert/strict";
import sharp from "sharp";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";
import { filterStrictExactMarketMatches } from "../src/lib/instacomp-exact-market-provider";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
import { buildInstaCompCuratedChecklistEvidence } from "../src/lib/instacomp-curated-checklist";
import { INSTACOMP_EBAY_BENCHMARK_CASES } from "../src/lib/instacomp-ebay-benchmark-cases";
import {
  benchmarkTitleEligible,
  benchmarkTitleHasExpectedParallel,
  benchmarkTitleHasExpectedSerialRun,
  benchmarkTitleHasExpectedYear,
} from "../src/lib/instacomp-benchmark-title";
import { detectInstaCompImageMime } from "../src/lib/instacomp-image-safety";
import {
  normalizeInstaCompRotation,
  rotateInstaCompImageBytes,
} from "../src/lib/instacomp-image-orientation";

async function main() {
function marketRow(
  title: string,
  options: Partial<Omit<InstaCompComp, "matchScore" | "flags">> = {},
): Omit<InstaCompComp, "matchScore" | "flags"> {
  return {
    title,
    price: options.price ?? 10,
    itemPrice: options.itemPrice ?? 8,
    shippingPrice: options.shippingPrice ?? 2,
    priceIncludesShipping: options.priceIncludesShipping ?? true,
    currency: "USD",
    url: options.url || `https://www.ebay.com/itm/${encodeURIComponent(title)}`,
    imageUrl: options.imageUrl ?? "https://i.ebayimg.com/test.jpg",
    source: options.source || "audit",
    sourceLabel: options.sourceLabel || "Audit",
    sourceCategory: options.sourceCategory || "sold",
    soldAt: options.soldAt === undefined ? "2026-07-20" : options.soldAt,
    listedAt: options.listedAt ?? null,
    observedAt: options.observedAt ?? "2026-07-27T00:00:00.000Z",
  };
}

const baseYoungGuns: InstaCompAiResult = {
  player: "Lane Hutson",
  year: "2024-25",
  brand: "Upper Deck",
  setName: "Upper Deck Series 1 Young Guns",
  cardNumber: "229",
  parallel: "Base",
  serialNumber: null,
  gradingCompany: null,
  gradeValue: null,
  certificationNumber: null,
  team: "Montreal Canadiens",
  sport: "Hockey",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 1,
  notes: null,
};

const exactBaseTitle = "2024-25 Upper Deck Lane Hutson Young Guns RC #229";
assert.equal(
  filterStrictExactMarketMatches([marketRow(exactBaseTitle)], baseYoungGuns, 10).length,
  1,
  "the exact unnumbered base Young Guns card must pass",
);
for (const variant of [
  "Clear Cut",
  "Outburst",
  "Deluxe",
  "Exclusives",
  "Canvas",
  "Red",
  "Black and White",
]) {
  assert.equal(
    filterStrictExactMarketMatches(
      [marketRow(`${exactBaseTitle} ${variant}`, { url: `https://www.ebay.com/itm/${variant}` })],
      baseYoungGuns,
      10,
    ).length,
    0,
    `Base must reject the ${variant} variation`,
  );
}

const nonRookie = { ...baseYoungGuns, isRookie: false };
assert.equal(
  filterStrictExactMarketMatches([marketRow(exactBaseTitle)], nonRookie, 10).length,
  0,
  "a non-rookie target must reject an RC listing",
);
assert.equal(
  filterStrictExactMarketMatches(
    [marketRow(`${exactBaseTitle} Signature`, { url: "https://www.ebay.com/itm/signature" })],
    baseYoungGuns,
    10,
  ).length,
  0,
  "a non-auto target must reject Signature wording",
);
assert.equal(
  filterStrictExactMarketMatches(
    [marketRow(`${exactBaseTitle} RPA`, { url: "https://www.ebay.com/itm/rpa" })],
    baseYoungGuns,
    10,
  ).length,
  0,
  "a non-auto/non-relic target must reject RPA wording",
);

const autographTarget = {
  ...baseYoungGuns,
  setName: "Rookie Signatures",
  cardNumber: "RS-LH",
  parallel: "Base",
  isAuto: true,
};
assert.equal(
  filterStrictExactMarketMatches(
    [marketRow("2024-25 Upper Deck Rookie Signatures Lane Hutson #RS-LH Signature")],
    autographTarget,
    10,
  ).length,
  1,
  "Signature must satisfy an exact autograph target",
);

const gradedTarget = {
  ...baseYoungGuns,
  gradingCompany: "PSA",
  gradeValue: "10",
  conditionGuess: "Graded",
};
assert.equal(
  filterStrictExactMarketMatches(
    [marketRow("2024-25 Upper Deck Lane Hutson Young Guns RC #229 PSA GEM MT 10")],
    gradedTarget,
    10,
  ).length,
  1,
  "PSA GEM MT 10 must be recognized as the exact grade",
);

function exactComp(
  title: string,
  overrides: Partial<InstaCompComp> = {},
): InstaCompComp {
  return {
    ...marketRow(title),
    matchScore: 200,
    flags: ["strict exact identity", "price includes reported shipping"],
    ...overrides,
  };
}
const undatedSold = exactComp(exactBaseTitle, { soldAt: null });
const datedSold = exactComp(exactBaseTitle, {
  url: "https://www.ebay.com/itm/dated",
  soldAt: "2026-07-20",
});
const shippingUnknown = exactComp(exactBaseTitle, {
  url: "https://www.ebay.com/itm/shipping-unknown",
  priceIncludesShipping: false,
  shippingPrice: null,
  flags: ["strict exact identity", "shipping unknown"],
});
const noTrustedSold = mergeExactMarketSources([
  {
    sold: {
      source: "audit_sold",
      label: "Audit Sold",
      status: "live",
      message: null,
      results: [undatedSold, shippingUnknown],
    },
    active: {
      source: "audit_active",
      label: "Audit Active",
      status: "no_matches",
      message: null,
      results: [],
    },
  },
]);
assert.equal(noTrustedSold.trustedSuggestedPrice, null);
assert.equal(noTrustedSold.pricing.soldCount, 0);
const trustedSold = mergeExactMarketSources([
  {
    sold: {
      source: "audit_sold",
      label: "Audit Sold",
      status: "live",
      message: null,
      results: [datedSold],
    },
    active: {
      source: "audit_active",
      label: "Audit Active",
      status: "no_matches",
      message: null,
      results: [],
    },
  },
]);
assert.equal(trustedSold.pricing.soldCount, 1);
assert.ok(Number(trustedSold.trustedSuggestedPrice) > 0);

const canvasCase = INSTACOMP_EBAY_BENCHMARK_CASES.find(
  (testCase) => testCase.id === "ud-s1-lane-hutson-canvas-young-guns-c111",
);
assert.ok(canvasCase);
function catalogAi(testCase: (typeof INSTACOMP_EBAY_BENCHMARK_CASES)[number]): InstaCompAiResult {
  return {
    player: testCase.expected.player,
    year: testCase.expected.year,
    brand: testCase.expected.brand,
    setName: testCase.expected.setName,
    cardNumber: testCase.expected.cardNumber,
    parallel: testCase.expected.parallel,
    serialNumber: testCase.expected.serialDenominator
      ? `01/${testCase.expected.serialDenominator}`
      : null,
    gradingCompany: null,
    gradeValue: null,
    certificationNumber: null,
    team: testCase.expected.team,
    sport: testCase.expected.sport,
    isRookie: testCase.expected.isRookie,
    isAuto: testCase.expected.isAuto,
    isRelic: testCase.expected.isRelic,
    conditionGuess: "Raw",
    confidence: 1,
    notes: null,
  };
}
assert.equal(
  buildInstaCompCuratedChecklistEvidence({ ai: catalogAi(canvasCase!) })?.status,
  "catalog_confirmed",
);
assert.equal(
  buildInstaCompCuratedChecklistEvidence({
    ai: {
      ...catalogAi(canvasCase!),
      setName: "2024-25 Upper Deck Series 1 UD Canvas Sepia Young Guns",
      parallel: "Sepia",
    },
  }),
  null,
  "an unlisted Sepia variation must not fall back to Canvas Young Guns",
);
assert.equal(
  buildInstaCompCuratedChecklistEvidence({
    ai: { ...catalogAi(canvasCase!), year: "2023-24" },
  }),
  null,
  "wrong season must not resolve to the official catalog card",
);
assert.equal(
  buildInstaCompCuratedChecklistEvidence({
    ai: { ...catalogAi(canvasCase!), isAuto: true },
  }),
  null,
  "wrong autograph state must not resolve to the official catalog card",
);

const serialCase = INSTACOMP_EBAY_BENCHMARK_CASES.find(
  (testCase) => Boolean(testCase.expected.serialDenominator),
);
assert.ok(serialCase);
assert.equal(
  buildInstaCompCuratedChecklistEvidence({ ai: catalogAi(serialCase!) })?.status,
  "catalog_confirmed",
);
assert.equal(
  buildInstaCompCuratedChecklistEvidence({
    ai: { ...catalogAi(serialCase!), serialNumber: "01/999" },
  }),
  null,
  "wrong serial denominator must not resolve to the official catalog card",
);

const baseCase = INSTACOMP_EBAY_BENCHMARK_CASES.find(
  (testCase) => testCase.id === "ud-s1-lane-hutson-young-guns-229",
);
assert.ok(baseCase);
assert.equal(benchmarkTitleHasExpectedYear(exactBaseTitle, baseCase!), true);
assert.equal(benchmarkTitleHasExpectedYear(exactBaseTitle.replace("2024-25", "2023-24"), baseCase!), false);
assert.equal(benchmarkTitleHasExpectedParallel(exactBaseTitle, baseCase!), true);
assert.equal(benchmarkTitleHasExpectedParallel(`${exactBaseTitle} Clear Cut`, baseCase!), false);
assert.equal(benchmarkTitleHasExpectedSerialRun(exactBaseTitle, baseCase!), true);
assert.equal(benchmarkTitleHasExpectedSerialRun(`${exactBaseTitle} 01/99`, baseCase!), false);
assert.equal(benchmarkTitleEligible(exactBaseTitle, baseCase!), true);
assert.equal(benchmarkTitleEligible(`${exactBaseTitle} Outburst`, baseCase!), false);
assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Lane Hutson", "Cole Caufield"), baseCase!),
  false,
  "benchmark source must reject the wrong player",
);
assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Upper Deck", "Topps"), baseCase!),
  false,
  "benchmark source must reject the wrong manufacturer",
);
assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Young Guns", "Dazzlers"), baseCase!),
  false,
  "benchmark source must reject the wrong insert or set",
);

const htmlBytes = new TextEncoder().encode("<html>not an image</html>");
assert.equal(detectInstaCompImageMime(htmlBytes), null);
assert.equal(normalizeInstaCompRotation(-90), 270);
assert.equal(normalizeInstaCompRotation(95), 90);
assert.equal(normalizeInstaCompRotation(44), 0);
async function runImageSafetyRegressions() {
  const sourcePng = await sharp({
    create: { width: 2, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();
  assert.equal(detectInstaCompImageMime(sourcePng), "image/png");
  const rotatedPng = await rotateInstaCompImageBytes({
    bytes: new Uint8Array(sourcePng),
    mime: "image/png",
    rotation: 90,
  });
  const rotatedMetadata = await sharp(rotatedPng).metadata();
  assert.equal(rotatedMetadata.width, 1);
  assert.equal(rotatedMetadata.height, 2);
}

runImageSafetyRegressions()
  .then(() => {
    console.log("InstaComp final adversarial audit regressions passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
