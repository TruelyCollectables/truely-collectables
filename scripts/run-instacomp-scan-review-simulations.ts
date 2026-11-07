import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";
import {
  buildInstaCompQueries,
  filterAndRankExactMatches,
  looksLikeBadCompTitle,
  type InstaCompAiResult,
  type InstaCompComp,
  type InstaCompStats,
} from "../src/lib/instacomp";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const ai: InstaCompAiResult = {
  player: "Connor Bedard",
  year: "2024-25",
  brand: "Upper Deck",
  setName: "O-Pee-Chee Platinum",
  cardNumber: "201",
  parallel: "Limited Red",
  serialNumber: null,
  team: "Chicago Blackhawks",
  sport: "Hockey",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 0.96,
  notes: "Parallel evidence: printed Limited Red. Serial evidence: no stamp visible.",
};
const stats: InstaCompStats = {
  low: 40,
  median: 45,
  average: 47.5,
  high: 55,
  suggestedPrice: 45,
};

function comp(id: string, title = `sale ${id}`): InstaCompComp {
  return {
    title,
    price: 45,
    itemPrice: 45,
    shippingPrice: 0,
    priceIncludesShipping: true,
    currency: "USD",
    url: `https://example.test/${id}`,
    imageUrl: null,
    source: "fixture",
    sourceLabel: "Fixture",
    sourceCategory: "sold",
    matchScore: 100,
    flags: ["player", "year", "set", "card #", "parallel"],
    saleId: id,
    saleVerified: true,
    finalPriceVerified: true,
    shippingVerified: true,
    soldAt: "2026-07-20T00:00:00Z",
  } as InstaCompComp;
}

const cases: Array<[string, () => void]> = [
  ["two verified sales permit pricing", () => {
    const result = buildInstaCompScanReview({
      ai,
      stats,
      marketValueComps: [comp("one"), comp("two")],
      hasBackImage: true,
      pairingConfidence: 0.98,
    });
    assert(result.trustedForPricing, result.reviewReasons.join(","));
  }],
  ["one verified sale is insufficient", () => {
    const result = buildInstaCompScanReview({
      ai,
      stats,
      marketValueComps: [comp("one")],
      hasBackImage: true,
      pairingConfidence: 0.98,
    });
    assert(!result.trustedForPricing, "one sale was trusted");
    assert(result.pricingReviewReasons.includes("insufficient_independent_verified_sales"), "missing reason");
  }],
  ["front-only scan is blocked", () => {
    const result = buildInstaCompScanReview({
      ai,
      stats,
      marketValueComps: [comp("one"), comp("two")],
      hasBackImage: false,
      pairingConfidence: null,
    });
    assert(result.identityReviewReasons.includes("front_only_scan"), "front-only reason missing");
  }],
  ["low identity confidence is blocked", () => {
    const result = buildInstaCompScanReview({
      ai: { ...ai, confidence: 0.9 },
      stats,
      marketValueComps: [comp("one"), comp("two")],
      hasBackImage: true,
      pairingConfidence: 0.98,
    });
    assert(result.identityReviewReasons.includes("low_identification_confidence"), "confidence reason missing");
  }],
  ["printed variation cannot remain Base", () => {
    const result = buildInstaCompScanReview({
      ai: { ...ai, parallel: "Base" },
      stats,
      marketValueComps: [comp("one"), comp("two")],
      hasBackImage: true,
      pairingConfidence: 0.98,
      externalOcrText: "LIMITED RED CARD 201",
    });
    assert(result.identityReviewReasons.includes("ocr_variant_signal_not_resolved"), "variant reason missing");
  }],
  ["multi-scanner disagreement is blocked", () => {
    const result = buildInstaCompScanReview({
      ai,
      stats,
      marketValueComps: [comp("one"), comp("two")],
      hasBackImage: true,
      pairingConfidence: 0.98,
      consensus: {
        status: "review_required",
        reviewReasons: ["multi_scanner_player_disagreement"],
      },
    });
    assert(result.identityReviewReasons.includes("multi_scanner_consensus_needs_review"), "consensus reason missing");
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const gradedAi: InstaCompAiResult = {
    ...ai,
    gradingCompany: "PSA",
    gradeValue: "10",
    certificationNumber: "12345678",
    certificationLookupUrl: "https://www.psacard.com/cert/12345678/psa",
    gradingEvidence: "PSA label; grade 10; cert 12345678.",
    conditionGuess: "Graded",
  };
  const queries = buildInstaCompQueries(gradedAi);
  const filtered = filterAndRankExactMatches(
    [
      {
        ...comp("graded", "2024-25 Upper Deck O-Pee-Chee Platinum Connor Bedard Limited Red #201 PSA 10 cert 12345678"),
        price: 200,
      },
      {
        ...comp("raw", "2024-25 Upper Deck O-Pee-Chee Platinum Connor Bedard Limited Red #201 raw"),
        price: 45,
      },
    ],
    gradedAi,
  );
  assert(queries.primary.includes("PSA 10"), "graded query missing grade");
  assert(filtered.length === 1 && filtered[0]?.title.includes("PSA 10"), "raw comp survived graded filter");
  assert(looksLikeBadCompTitle("Connor Bedard PSA 10", ai), "graded comp accepted for raw target");
  console.log("PASS graded slab comps require matching grader and grade");
} catch (error) {
  failed += 1;
  console.error(`FAIL graded comp matching: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`InstaComp scan review simulations: ${cases.length + 1 - failed}/${cases.length + 1} passed.`);
if (failed) process.exitCode = 1;
