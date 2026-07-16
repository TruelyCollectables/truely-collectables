import {
  applyInstaCompConsensusToAi,
  buildInstaCompMultiScannerConsensus,
  buildInstaCompReaderFindingFromAi,
  decideInstaCompConsensusEscalation,
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
    name: "obvious complete identity stays on fast lane",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          setName: "Upper Deck Extended Series",
          cardNumber: "656",
          parallel: null,
          confidence: 0.97,
          notes: "Base-like card checked; no variant, serial, autograph, or relic evidence visible.",
        },
        externalOcrText: "2025-26 Upper Deck Extended Series Connor McDavid 656 Edmonton Oilers",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "fast_lane", "Expected obvious card fast lane");
      assert(decision.councilMode === "fast_lane_council", "Expected fast council");
      assert(decision.riskTier === "low", "Expected low-risk fast lane");
      assert(!decision.runSecondaryVision, "Fast lane must not run second AI reader");
      assert(decision.reasons.length === 0, "Fast lane should not have escalation reasons");
      assert(
        !decision.scannerPlan.includes("secondary_ai_vision"),
        "Fast lane must not spend the second AI reader",
      );
      assert(
        decision.scannerPlan.includes("catalog_referee_when_available"),
        "Fast lane must still include catalog referee when available",
      );
    },
  },
  {
    name: "copyright season slash does not trigger numbered-card escalation",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          setName: "Upper Deck Extended Series",
          cardNumber: "656",
          parallel: null,
          confidence: 0.97,
          notes: "Back copyright reads 2024/25; no serial stamp visible.",
        },
        externalOcrText:
          "2024/25 Upper Deck authenticated CLC NHLPA Connor McDavid 656",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "fast_lane", "Copyright year must stay fast lane");
      assert(
        !decision.reasons.includes("serial_numbered_or_numbered_signal"),
        "Copyright year must not look like a serial-numbered card",
      );
    },
  },
  {
    name: "printed variant signal escalates to second AI identity reader",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          parallel: "Base",
          confidence: 0.96,
          notes: "Primary reader called the card Base.",
        },
        externalOcrText: "OUTLIERS CONNOR MCDAVID O-8",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "escalated_multi_ai", "Expected escalation lane");
      assert(decision.councilMode === "full_council", "Expected full council");
      assert(decision.riskTier === "high", "Expected high-risk variant escalation");
      assert(decision.runSecondaryVision, "Variant signal must run second AI reader");
      assert(
        decision.scannerPlan.includes("secondary_ai_vision"),
        "Full council must include second AI reader",
      );
      assert(
        decision.reasons.includes("printed_variant_signal_needs_second_reader"),
        "Expected printed variant escalation reason",
      );
    },
  },
  {
    name: "insert card-number prefix cannot fast-lane as generic base",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          cardNumber: "C-369",
          parallel: "Base",
          confidence: 0.97,
          notes: "Primary reader called it a normal base card.",
        },
        externalOcrText: null,
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "escalated_multi_ai", "Expected prefix escalation");
      assert(decision.runSecondaryVision, "Insert prefix must run second AI reader");
      assert(
        decision.reasons.includes("insert_card_number_prefix_needs_second_reader"),
        "Expected insert card-number prefix reason",
      );
    },
  },
  {
    name: "named insert card-number prefix can stay fast lane",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          cardNumber: "C-369",
          setName: "Upper Deck Canvas",
          parallel: "Canvas",
          confidence: 0.97,
          notes: "Canvas insert is printed and named by the reader.",
        },
        externalOcrText: "UPPER DECK CANVAS C-369",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "fast_lane", "Named insert should not pay for second reader");
      assert(
        !decision.reasons.includes("insert_card_number_prefix_needs_second_reader"),
        "Named insert should not include prefix escalation reason",
      );
    },
  },
  {
    name: "autograph or relic marker escalates even at high confidence",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          parallel: null,
          isAuto: true,
          confidence: 0.98,
          notes: "Autograph issue; signature marker visible on front.",
        },
        externalOcrText: "AUTHENTIC AUTOGRAPH",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });

      assert(decision.speedLane === "escalated_multi_ai", "Auto card must escalate");
      assert(
        decision.reasons.includes("autograph_or_relic_signal_needs_second_reader"),
        "Expected autograph/relic escalation reason",
      );
    },
  },
  {
    name: "low confidence or missing critical fields escalates to second AI identity reader",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          player: "Connor McDavid",
          year: "2025-26",
          brand: "Upper Deck",
          setName: null,
          cardNumber: null,
          parallel: null,
          confidence: 0.81,
          notes: "Exact set and card number uncertain.",
        },
        externalOcrText: null,
        hasBackImage: true,
        pairingConfidence: 0.9,
      });

      assert(decision.runSecondaryVision, "Low-confidence incomplete card must escalate");
      assert(decision.riskTier === "high", "Expected high-risk uncertain identity");
      assert(
        decision.reasons.includes("primary_confidence_below_fast_lane"),
        "Expected low-confidence escalation reason",
      );
      assert(decision.reasons.includes("missing_setName"), "Expected missing set reason");
      assert(decision.reasons.includes("missing_cardNumber"), "Expected missing card reason");
    },
  },
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
    name: "fast lane exposes thin single-reader council warning",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          setName: "Upper Deck Extended Series",
          cardNumber: "656",
          parallel: null,
          confidence: 0.98,
          notes: "Straightforward card identity.",
        },
        externalOcrText: null,
        hasBackImage: true,
        pairingConfidence: 0.96,
      });
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [primary(baseAi)],
        escalation: decision,
      });

      assert(consensus.status === "consensus_confirmed", "Thin fast lane stays confirmed");
      assert(consensus.councilReadiness.status === "warning", "Expected thin-council warning");
      assert(
        consensus.councilReadiness.reasons.includes(
          "fast_lane_single_reader_no_supporting_scanner",
        ),
        "Expected visible fast-lane thin evidence reason",
      );
      assert(consensus.trustedForIdentity, "Warning should not block a high-confidence fast lane");
    },
  },
  {
    name: "full council missing second AI reader forces review",
    run() {
      const decision = decideInstaCompConsensusEscalation({
        ai: {
          ...baseAi,
          cardNumber: "O-8",
          parallel: "Base",
          confidence: 0.96,
          notes: "Primary reader called the card Base.",
        },
        externalOcrText: "OUTLIERS CONNOR MCDAVID O-8",
        hasBackImage: true,
        pairingConfidence: 0.96,
      });
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [primary(baseAi)],
        escalation: decision,
      });

      assert(consensus.status === "review_required", "Incomplete full council must need review");
      assert(
        consensus.reviewReasons.includes("full_council_missing_second_ai_reader"),
        "Expected missing second AI reader review reason",
      );
      assert(
        consensus.councilReadiness.missingReaderKinds.includes("secondary_vision"),
        "Expected missing secondary reader kind",
      );
      assert(!consensus.trustedForIdentity, "Incomplete full council cannot be trusted");
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
  {
    name: "critical card number disagreement cannot be won by weight alone",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: baseAi,
        readers: [
          primary({
            ...baseAi,
            cardNumber: "O-8",
            confidence: 0.99,
          }),
          {
            readerId: "second-vision",
            label: "Second AI vision",
            kind: "other",
            identity: { cardNumber: "0-8" },
            confidence: 0.5,
            evidence: ["second reader saw zero-eight instead of letter O-eight"],
          },
        ],
      });

      assert(consensus.status === "review_required", "Expected critical card number review");
      assert(
        consensus.reviewReasons.includes("multi_scanner_cardNumber_disagreement"),
        "Expected card number disagreement reason",
      );
    },
  },
  {
    name: "positive autograph marker beats generic false default",
    run() {
      const consensus = buildInstaCompMultiScannerConsensus({
        baseIdentity: {
          ...baseAi,
          isAuto: false,
        },
        readers: [
          primary({
            ...baseAi,
            isAuto: false,
          }),
          {
            readerId: "printed-auto-guard",
            label: "OCR/printed evidence guard",
            kind: "ocr_printed_evidence",
            identity: { isAuto: true },
            confidence: 0.92,
            evidence: ["front/back text identifies autograph issue"],
          },
        ],
      });

      assert(consensus.status === "consensus_confirmed", "Expected positive marker consensus");
      assert(consensus.finalIdentity.isAuto === true, "Expected autograph marker to apply");
      assert(
        consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "isAuto" &&
            decision.status === "positive_marker_over_negative_default",
        ),
        "Expected positive marker over negative default decision",
      );
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
  console.error(`InstaComp™ consensus simulations failed: ${failures.length}`);
  process.exit(1);
}

console.log(`InstaComp™ consensus simulations: ${scenarios.length}/${scenarios.length} passed.`);
