import { applyInstaCompIdentityGuard } from "../src/lib/instacomp-identity-guard";
import type { InstaCompAiResult } from "../src/lib/instacomp";

type Scenario = {
  name: string;
  ai: InstaCompAiResult;
  externalOcrText: string;
  expect: (actual: InstaCompAiResult) => void;
};

const baseAi: InstaCompAiResult = {
  player: "Fixture Player",
  year: "2024",
  brand: "Upper Deck",
  setName: "Base",
  cardNumber: "1",
  parallel: "Base",
  serialNumber: null,
  team: "Fixture Team",
  sport: "Hockey",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 0.94,
  notes: "Parallel evidence: no special finish detected.",
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const scenarios: Scenario[] = [
  {
    name: "printed Limited Red overrides base",
    ai: baseAi,
    externalOcrText:
      "FRONT OCR: 2024 Upper Deck Fixture Player. BACK OCR: LIMITED RED. Card 1.",
    expect(actual) {
      assert(actual.parallel === "Limited Red", `Expected Limited Red, received ${actual.parallel}`);
      assert(actual.notes?.includes("Identity guardrail") === true, "Expected guardrail note");
    },
  },
  {
    name: "Upper Deck Clear Cut overrides base and set",
    ai: { ...baseAi, setName: null, parallel: "Base" },
    externalOcrText:
      "UPPER DECK CLEAR CUT Hockey. Fixture Player. Congratulations text on acetate card.",
    expect(actual) {
      assert(actual.parallel === "Clear Cut", `Expected Clear Cut parallel, received ${actual.parallel}`);
      assert(actual.setName === "Clear Cut", `Expected Clear Cut setName, received ${actual.setName}`);
    },
  },
  {
    name: "printed generic insert cannot remain base",
    ai: baseAi,
    externalOcrText:
      "Fixture Player INSERT card. Collect all special insert cards from this subset.",
    expect(actual) {
      assert(
        actual.parallel === "Insert - exact type uncertain",
        `Expected insert review parallel, received ${actual.parallel}`,
      );
      assert(actual.confidence <= 0.84, `Expected lowered confidence, received ${actual.confidence}`);
    },
  },
  {
    name: "specific non-base AI parallel is preserved",
    ai: { ...baseAi, parallel: "Red Foil", setName: "Main Set" },
    externalOcrText: "BACK OCR: limited red style odds copy.",
    expect(actual) {
      assert(actual.parallel === "Red Foil", `Expected Red Foil preserved, received ${actual.parallel}`);
      assert(actual.notes?.includes("preserved AI parallel") === true, "Expected preserved note");
    },
  },
  {
    name: "normal base with no printed signal is suppressed",
    ai: baseAi,
    externalOcrText: "Fixture Player 2024 Upper Deck Card 1 National Hockey League.",
    expect(actual) {
      assert(actual.parallel === null, `Expected Base suppressed, received ${actual.parallel}`);
      assert(actual.notes?.includes("suppressed generic Base") === true, "Expected suppressed base note");
    },
  },
  {
    name: "uncertain insert label without printed signal is suppressed",
    ai: {
      ...baseAi,
      setName: "WNBA Select - Premier Level",
      parallel: "Insert - exact type uncertain",
      notes: "Parallel evidence: level text visible, exact insert unclear.",
    },
    externalOcrText:
      "Fixture Player 2025 Panini WNBA Select Premier Level Card 142.",
    expect(actual) {
      assert(actual.parallel === null, `Expected uncertain insert suppressed, received ${actual.parallel}`);
      assert(actual.notes?.includes("suppressed uncertain parallel") === true, "Expected uncertain parallel note");
    },
  },
];

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];

for (const scenario of scenarios) {
  try {
    const actual = applyInstaCompIdentityGuard(scenario.ai, {
      externalOcrText: scenario.externalOcrText,
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
  `InstaComp identity guard simulations: ${results.length - failed.length}/${results.length} passed.`,
);

if (failed.length) process.exitCode = 1;
