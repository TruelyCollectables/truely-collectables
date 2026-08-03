from pathlib import Path

path = Path("scripts/run-instacomp-consensus-simulations.ts")
text = path.read_text()

replacements = [
(
'''  {
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
''',
'''  {
    name: "catalog referee cannot override conflicting scanner parallel evidence",
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
          matchExplanation: "Checklist claims O-8 is Outliers.",
          identity: {
            player: "Connor McDavid",
            year: "2025-26",
            setName: "SP Authentic",
            cardNumber: "O-8",
            parallel: "Outliers",
          },
        },
      });

      assert(consensus.status === "review_required", "Conflicting catalog must require review");
      assert(consensus.finalIdentity.parallel === "Base", "Scanner evidence must remain visible");
      assert(
        consensus.catalogReferee.status === "review_required",
        "Catalog referee must be quarantined",
      );
      assert(
        !consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "parallel" &&
            decision.status === "catalog_referee",
        ),
        "Rejected catalog must not decide parallel",
      );
    },
  },
'''
),
(
'''  {
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
''',
'''  {
    name: "fast lane single-reader identity remains blocked",
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

      assert(consensus.status === "review_required", "Single-reader identity must be blocked");
      assert(consensus.councilReadiness.status === "warning", "Expected thin-council warning");
      assert(
        consensus.councilReadiness.reasons.includes(
          "fast_lane_single_reader_no_supporting_scanner",
        ),
        "Expected visible fast-lane thin evidence reason",
      );
      assert(!consensus.trustedForIdentity, "One reader cannot authorize exact identity");
    },
  },
'''
),
(
'''  {
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
''',
'''  {
    name: "specific printed parallel cannot beat conflicting base without confirmation",
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

      assert(consensus.status === "review_required", "Parallel conflict must require review");
      assert(consensus.finalIdentity.parallel === "Clear Cut", "Candidate observation should remain visible");
      assert(
        consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "parallel" &&
            decision.status === "review_required",
        ),
        "Expected hard parallel review decision",
      );
      assert(!consensus.trustedForIdentity, "Conflicting parallel evidence cannot be trusted");
    },
  },
'''
),
(
'''  {
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
''',
'''  {
    name: "single serial reader preserves candidate but cannot confirm identity",
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

      assert(consensus.status === "review_required", "One serial reader cannot confirm identity");
      assert(finalAi.serialNumber === "07/50", "Candidate serial should remain visible");
      assert(finalAi.notes?.includes("needs review"), "Expected review notes trail");
      assert(!consensus.trustedForIdentity, "Single serial evidence cannot authorize comps");
    },
  },
'''
),
(
'''  {
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
''',
'''  {
    name: "single positive autograph marker preserves candidate but remains blocked",
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

      assert(consensus.status === "review_required", "One positive marker cannot confirm identity");
      assert(consensus.finalIdentity.isAuto === true, "Autograph candidate should remain visible");
      assert(
        consensus.fieldDecisions.some(
          (decision) =>
            decision.field === "isAuto" &&
            decision.status === "positive_marker_over_negative_default",
        ),
        "Expected positive marker observation",
      );
      assert(!consensus.trustedForIdentity, "Single marker cannot authorize exact identity");
    },
  },
'''
),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one stale consensus scenario, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
print("Updated stale consensus expectations to fail-closed identity firewall contract.")
