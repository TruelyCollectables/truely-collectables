import {
  applyInstaCompConsensusToAi,
  buildInstaCompMultiScannerConsensus,
  buildInstaCompReaderFindingFromAi,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";
import type { InstaCompAiResult } from "../src/lib/instacomp";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const baseAi: InstaCompAiResult = {
  player: "Connor McDavid",
  year: "2025-26",
  brand: "Upper Deck",
  setName: "SP Authentic",
  cardNumber: "O-8",
  parallel: "Base",
  serialNumber: null,
  team: "Edmonton Oilers",
  sport: "Hockey",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: null,
  confidence: 0.95,
  notes: null,
};

function primary(ai: InstaCompAiResult): InstaCompConsensusReaderFinding {
  return buildInstaCompReaderFindingFromAi({
    readerId: "primary",
    label: "Primary AI vision",
    kind: "primary_vision",
    ai,
    evidence: ["front/back model read"],
  });
}

const scenarios = [
  {
    name: "catalog referee overrides two generic base scanner votes",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [
          primary(baseAi),
          {
            readerId: "ocr",
            label: "OCR printed evidence",
            kind: "ocr_printed_evidence",
            identity: { parallel: "Base" },
            confidence: 0.88,
            evidence: ["OCR did not isolate insert name"],
          },
        ],
        catalogReferee: {
          status: "catalog_confirmed",
          sourceLabel: "Fixture Checklist",
          catalogId: "spa-2025-o-8-outliers",
          matchExplanation: "Checklist confirms O-8 is Outliers.",
          identity: {
            player: "Connor McDavid",
            year: "2025-26",
            setName: "SP Authentic",
            cardNumber: "O-8",
            parallel: "Outliers",
          },
        },
      });

      assert(consensus.status === "consensus_confirmed", "Expected confirmed consensus");
      assert(consensus.finalIdentity.parallel === "Outliers", "Catalog should set Outliers");
      assert(
        consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "parallel" &&
            decision.status === "catalog_referee" &&
            decision.conflictingValues.includes("Base"),
        ),
        "Expected catalog referee to preserve base conflict evidence",
      );
    },
  },
  {
    name: "specific printed clear cut beats generic base without catalog",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [
          primary(baseAi),
          {
            readerId: "clear-cut-ocr",
            label: "OCR/printed evidence guard",
            kind: "ocr_printed_evidence",
            identity: { parallel: "Clear Cut" },
            confidence: 0.94,
            weight: 1.1,
            evidence: ["Back logo says Upper Deck Clear Cut"],
          },
        ],
      });

      assert(consensus.status === "consensus_confirmed", "Expected clear cut consensus");
      assert(consensus.finalIdentity.parallel === "Clear Cut", "Expected Clear Cut parallel");
      assert(
        consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "parallel" &&
            decision.status === "specific_variant_over_base",
        ),
        "Expected specific variant over base decision",
      );
    },
  },
  {
    name: "serial reader fills missing serial number",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [
          primary(baseAi),
          {
            readerId: "serial",
            label: "Serial vision/OCR",
            kind: "serial_vision",
            identity: { serialNumber: "07/50" },
            confidence: 0.99,
            evidence: ["foil stamp crop read 07/50"],
          },
        ],
      });
      const finalAi = applyInstaCompConsensusToAi(baseAi, consensus);

      assert(consensus.status === "consensus_confirmed", "Expected serial consensus");
      assert(finalAi.serialNumber === "07/50", "Expected serial to be applied");
      assert(finalAi.notes?.includes("Multi-scanner consensus confirmed"), "Expected notes trail");
    },
  },
  {
    name: "unresolved player disagreement blocks trusted identity",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [
          primary(baseAi),
          {
            readerId: "second-vision",
            label: "Second AI vision",
            kind: "other",
            identity: { player: "Leon Draisaitl" },
            confidence: 0.95,
            evidence: ["second reader saw different printed name"],
          },
        ],
      });

      assert(consensus.status === "review_required", "Expected review");
      assert(
        consensus.reviewReasons.includes("multi_scanner_player_disagreement"),
        "Expected player disagreement reason",
      );
      assert(consensus.suggestedQuestion?.includes("player"), "Expected player question");
    },
  },
];

const failures: string[] = [];

for (const scenario of scenarios) {
  try {
    scenario.run();
    console.log(`PASS ${scenario.name}`);
  } catch (error: any) {
    failures.push(`${scenario.name}: ${error?.message || error}`);
    console.error(`FAIL ${scenario.name}: ${error?.message || error}`);
  }
}

if (failures.length) {
  console.error(`InstaComp consensus simulations failed: ${failures.length}`);
  process.exit(1);
}

console.log(`InstaComp consensus simulations: ${scenarios.length}/${scenarios.length} passed.`);
