import { buildInstaCompScanReview } from "../src/lib/instacomp-scan-review";
import type { InstaCompAiResult, InstaCompComp, InstaCompStats } from "../src/lib/instacomp";

type Scenario = {
  name: string;
  ai?: Partial<InstaCompAiResult>;
  stats?: Partial<InstaCompStats>;
  marketValueComps?: Partial<InstaCompComp>[];
  hasBackImage?: boolean;
  pairingConfidence?: number | null;
  externalOcrText?: string | null;
  expect: (actual: ReturnType<typeof buildInstaCompScanReview>) => void;
};

const trustedAi: InstaCompAiResult = {
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
  notes: "Parallel evidence: printed Limited Red. Serial evidence: no serial stamp visible.",
};

const trustedStats: InstaCompStats = {
  low: 40,
  median: 45,
  average: 47.5,
  high: 55,
  suggestedPrice: 45,
};

const comp = (title: string): InstaCompComp => ({
  title,
  price: 45,
  currency: "USD",
  url: `https://example.com/${encodeURIComponent(title)}`,
  imageUrl: null,
  source: "fixture",
  sourceLabel: "Fixture",
  sourceCategory: "sold",
  matchScore: 100,
  flags: ["player", "year", "set", "card #", "parallel"],
});

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const scenarios: Scenario[] = [
  {
    name: "trusted exact identity and two comps can price",
    marketValueComps: [comp("sale one"), comp("sale two")],
    expect(actual) {
      assert(actual.trustedForPricing, `Expected trusted pricing, got ${actual.reviewReasons.join(", ")}`);
      assert(actual.reviewReasons.length === 0, `Expected no review reasons, got ${actual.reviewReasons.join(", ")}`);
    },
  },
  {
    name: "high confidence below trusted threshold forces review",
    ai: { confidence: 0.9 },
    marketValueComps: [comp("sale one"), comp("sale two")],
    expect(actual) {
      assert(!actual.trustedForPricing, "Expected pricing blocked");
      assert(actual.reviewReasons.includes("low_identification_confidence"), "Expected low confidence reason");
    },
  },
  {
    name: "front only cannot auto price",
    hasBackImage: false,
    marketValueComps: [comp("sale one"), comp("sale two")],
    expect(actual) {
      assert(!actual.trustedForPricing, "Expected front-only pricing blocked");
      assert(actual.reviewReasons.includes("front_only_scan"), "Expected front-only reason");
    },
  },
  {
    name: "OCR variant signal cannot remain base",
    ai: { parallel: "Base" },
    externalOcrText: "BACK OCR LIMITED RED PRINTED ODDS CARD 201",
    marketValueComps: [comp("sale one"), comp("sale two")],
    expect(actual) {
      assert(!actual.trustedForPricing, "Expected unresolved OCR variant blocked");
      assert(
        actual.reviewReasons.includes("ocr_variant_signal_not_resolved"),
        "Expected unresolved OCR variant reason",
      );
    },
  },
  {
    name: "base card without printed variant signal can price without base label",
    ai: { parallel: null },
    externalOcrText: "BACK OCR Connor Bedard 2024-25 O-Pee-Chee Platinum card 201",
    marketValueComps: [comp("sale one"), comp("sale two")],
    expect(actual) {
      assert(actual.trustedForPricing, `Expected base identity trusted, got ${actual.reviewReasons.join(", ")}`);
      assert(
        !actual.reviewReasons.includes("parallel_needs_review"),
        "Expected no parallel review for base/no-variant card",
      );
    },
  },
  {
    name: "one comp is not enough for autoprice",
    marketValueComps: [comp("sale one")],
    expect(actual) {
      assert(!actual.trustedForPricing, "Expected one-comp pricing blocked");
      assert(
        actual.reviewReasons.includes("insufficient_exact_comp_evidence"),
        "Expected insufficient comp evidence reason",
      );
    },
  },
];

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];

for (const scenario of scenarios) {
  try {
    const actual = buildInstaCompScanReview({
      ai: { ...trustedAi, ...scenario.ai },
      stats: { ...trustedStats, ...scenario.stats },
      marketValueComps: (scenario.marketValueComps || [
        comp("sale one"),
        comp("sale two"),
      ]) as InstaCompComp[],
      hasBackImage: scenario.hasBackImage ?? true,
      pairingConfidence: scenario.pairingConfidence ?? 0.98,
      externalOcrText: scenario.externalOcrText || null,
    });
    scenario.expect(actual);
    results.push({ name: scenario.name, status: "passed" });
  } catch (error) {
    results.push({
      name: scenario.name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${result.name}${
      result.error ? ` - ${result.error}` : ""
    }`,
  );
}

const failed = results.filter((result) => result.status === "failed");

console.log(
  `InstaComp scan review simulations: ${results.length - failed.length}/${results.length} passed.`,
);

if (failed.length) process.exitCode = 1;
