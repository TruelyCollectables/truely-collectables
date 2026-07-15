import {
  buildInstaCompCatalogCompGate,
  resolveInstaCompCatalogIdentity,
  type InstaCompCatalogCandidate,
  type InstaCompCatalogIdentityInput,
} from "../src/lib/instacomp-catalog-identity";

const CATALOG_IDENTITY_EXPECTED_SCENARIO_KEYS = [
  "catalog_confirms_exact_parallel_before_comps",
  "catalog_confirmed_gate_uses_catalog_fields_for_exact_comps",
  "unapproved_source_forces_review_required",
  "parallel_ambiguity_forces_targeted_review",
  "review_required_gate_blocks_exact_comp_trust",
  "serial_run_mismatch_forces_review_required",
  "missing_catalog_candidates_force_review_required",
] as const;
const CATALOG_IDENTITY_EXPECTED_SCENARIO_COUNT =
  CATALOG_IDENTITY_EXPECTED_SCENARIO_KEYS.length;

type SimulationScenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed";
  detail: string;
  assertions: Record<string, unknown>;
};

const target: InstaCompCatalogIdentityInput = {
  player: "Shohei Ohtani",
  year: "2023",
  brand: "Topps Chrome",
  setName: "Update",
  cardNumber: "USC17",
  parallel: "Gold Refractor",
  variation: "Gold Refractor",
  serialRun: "/50",
  team: "Los Angeles Angels",
  sport: "Baseball",
  isAuto: false,
  isRelic: false,
};

function catalogCandidate(
  overrides: Partial<InstaCompCatalogCandidate>,
): InstaCompCatalogCandidate {
  return {
    catalogId: "fixture-2023-tcu-usc17-gold-ref",
    source: "fixture_checklist",
    sourceLabel: "Fixture Checklist",
    sourceUrl: "https://example.test/catalog/2023-topps-chrome-update/usc17",
    sourceUsageAllowed: true,
    player: "Shohei Ohtani",
    year: "2023",
    brand: "Topps Chrome",
    setName: "Update",
    cardNumber: "USC17",
    parallel: "Gold Refractor",
    variation: "Gold Refractor",
    serialRun: "/50",
    team: "Los Angeles Angels",
    sport: "Baseball",
    isAuto: false,
    isRelic: false,
    ...overrides,
  };
}

function scenario(
  scenarioKey: string,
  detail: string,
  condition: boolean,
  assertions: Record<string, unknown>,
): SimulationScenario {
  return {
    scenario_key: scenarioKey,
    scenario_status: condition ? "passed" : "failed",
    detail,
    assertions,
  };
}

function runCatalogIdentitySimulationSuite() {
  const scenarios: SimulationScenario[] = [];

  const confirmed = resolveInstaCompCatalogIdentity(target, [
    catalogCandidate({}),
    catalogCandidate({
      catalogId: "fixture-2023-tcu-usc17-base",
      parallel: "Base",
      variation: "Base",
      serialRun: null,
    }),
    catalogCandidate({
      catalogId: "fixture-2023-tcu-usc18-gold-ref",
      cardNumber: "USC18",
    }),
  ]);
  scenarios.push(
    scenario(
      "catalog_confirms_exact_parallel_before_comps",
      "A permitted checklist candidate with matching year, brand, set, card number, player, parallel, and serial run is catalog_confirmed before comps are trusted.",
      confirmed.status === "catalog_confirmed" &&
        confirmed.selectedMatch?.candidate.catalogId ===
          "fixture-2023-tcu-usc17-gold-ref" &&
        confirmed.selectedMatch.score >= 88 &&
        confirmed.matchExplanation.includes("Fixture Checklist"),
      {
        status: confirmed.status,
        selectedCatalogId: confirmed.selectedMatch?.candidate.catalogId,
        score: confirmed.selectedMatch?.score,
        explanation: confirmed.matchExplanation,
      },
    ),
  );

  const confirmedGate = buildInstaCompCatalogCompGate(
    { ...target, variation: null },
    [catalogCandidate({})],
  );
  scenarios.push(
    scenario(
      "catalog_confirmed_gate_uses_catalog_fields_for_exact_comps",
      "When catalog identity is confirmed, the comp gate exposes catalog-normalized fields and allows exact comp search.",
      confirmedGate.status === "catalog_confirmed" &&
        confirmedGate.exactCompSearchAllowed &&
        confirmedGate.trustedForExactComps &&
        confirmedGate.compIdentity?.parallel === "Gold Refractor" &&
        confirmedGate.compIdentity.catalogId ===
          "fixture-2023-tcu-usc17-gold-ref" &&
        confirmedGate.reviewReasons.length === 0,
      {
        status: confirmedGate.status,
        exactCompSearchAllowed: confirmedGate.exactCompSearchAllowed,
        trustedForExactComps: confirmedGate.trustedForExactComps,
        compIdentity: confirmedGate.compIdentity,
        reviewReasons: confirmedGate.reviewReasons,
      },
    ),
  );

  const unapproved = resolveInstaCompCatalogIdentity(target, [
    catalogCandidate({
      sourceUsageAllowed: false,
      sourceLabel: "Unlicensed Fixture Checklist",
    }),
  ]);
  scenarios.push(
    scenario(
      "unapproved_source_forces_review_required",
      "A high-scoring catalog match remains review_required when the source is not approved for TCOS commercial use.",
      unapproved.status === "review_required" &&
        unapproved.reviewReasons.includes(
          "selected catalog source is not approved for TCOS use",
        ),
      {
        status: unapproved.status,
        reviewReasons: unapproved.reviewReasons,
        score: unapproved.selectedMatch?.score,
      },
    ),
  );

  const ambiguous = resolveInstaCompCatalogIdentity(
    { ...target, variation: null },
    [
      catalogCandidate({}),
      catalogCandidate({
        catalogId: "fixture-2023-tcu-usc17-gold-wave",
        parallel: "Gold Wave Refractor",
        variation: "Gold Wave Refractor",
      }),
    ],
  );
  scenarios.push(
    scenario(
      "parallel_ambiguity_forces_targeted_review",
      "Near-tied parallel candidates stay review_required and return one targeted operator question instead of guessing the variation.",
      ambiguous.status === "review_required" &&
        ambiguous.reviewReasons.some((reason) =>
          reason.includes("selected catalog score gap"),
        ) &&
        Boolean(ambiguous.suggestedQuestion),
      {
        status: ambiguous.status,
        reviewReasons: ambiguous.reviewReasons,
        suggestedQuestion: ambiguous.suggestedQuestion,
        selectedScore: ambiguous.selectedMatch?.score,
        alternateScore: ambiguous.alternateMatches[0]?.score,
      },
    ),
  );

  const reviewGate = buildInstaCompCatalogCompGate(target, [
    catalogCandidate({
      catalogId: "fixture-2023-tcu-usc17-blue-ref",
      parallel: "Blue Refractor",
      variation: "Blue Refractor",
    }),
  ]);
  scenarios.push(
    scenario(
      "review_required_gate_blocks_exact_comp_trust",
      "When catalog identity remains unresolved, the comp gate blocks trusted exact comps and preserves review reasons.",
      reviewGate.status === "review_required" &&
        reviewGate.exactCompSearchAllowed === false &&
        reviewGate.trustedForExactComps === false &&
        reviewGate.compIdentity === null &&
        reviewGate.reviewReasons.includes(
          "catalog identity unresolved before exact comps",
        ),
      {
        status: reviewGate.status,
        exactCompSearchAllowed: reviewGate.exactCompSearchAllowed,
        trustedForExactComps: reviewGate.trustedForExactComps,
        compIdentity: reviewGate.compIdentity,
        reviewReasons: reviewGate.reviewReasons,
      },
    ),
  );

  const serialMismatch = resolveInstaCompCatalogIdentity(target, [
    catalogCandidate({ serialRun: "/99" }),
  ]);
  scenarios.push(
    scenario(
      "serial_run_mismatch_forces_review_required",
      "A catalog candidate with the wrong serial-number print run is not accepted as an exact match.",
      serialMismatch.status === "review_required" &&
        serialMismatch.reviewReasons.includes(
          "selected catalog candidate has a critical mismatch",
        ) &&
        Boolean(
          serialMismatch.selectedMatch?.mismatchedEvidence.includes(
            "serial run did not match",
          ),
        ),
      {
        status: serialMismatch.status,
        reviewReasons: serialMismatch.reviewReasons,
        mismatches: serialMismatch.selectedMatch?.mismatchedEvidence,
      },
    ),
  );

  const missingCandidates = resolveInstaCompCatalogIdentity(target, []);
  scenarios.push(
    scenario(
      "missing_catalog_candidates_force_review_required",
      "No catalog candidates means InstaComp cannot claim catalog-confirmed identity and must keep the row in Needs Review.",
      missingCandidates.status === "review_required" &&
        missingCandidates.reviewReasons.includes(
          "no catalog candidates were available",
        ),
      {
        status: missingCandidates.status,
        reviewReasons: missingCandidates.reviewReasons,
      },
    ),
  );

  const expectedScenarioKeys = [...CATALOG_IDENTITY_EXPECTED_SCENARIO_KEYS];
  const actualScenarioKeys = scenarios.map((item) => item.scenario_key);
  const missingScenarioKeys = expectedScenarioKeys.filter(
    (key) => !actualScenarioKeys.includes(key),
  );
  const unexpectedScenarioKeys = actualScenarioKeys.filter(
    (key) => !expectedScenarioKeys.includes(key as any),
  );
  const failedScenarios = scenarios.filter(
    (item) => item.scenario_status !== "passed",
  );
  const scenarioCoverageStatus: "passed" | "failed" =
    scenarios.length === CATALOG_IDENTITY_EXPECTED_SCENARIO_COUNT
      ? "passed"
      : "failed";
  const scenarioKeyCoverageStatus: "passed" | "failed" =
    missingScenarioKeys.length === 0 && unexpectedScenarioKeys.length === 0
      ? "passed"
      : "failed";
  const runStatus: "passed" | "failed" =
    failedScenarios.length === 0 &&
    scenarioCoverageStatus === "passed" &&
    scenarioKeyCoverageStatus === "passed"
      ? "passed"
      : "failed";

  return {
    run_status: runStatus,
    scenario_count: scenarios.length,
    expected_scenario_count: CATALOG_IDENTITY_EXPECTED_SCENARIO_COUNT,
    scenario_coverage_status: scenarioCoverageStatus,
    scenario_key_coverage_status: scenarioKeyCoverageStatus,
    expected_scenario_keys: expectedScenarioKeys,
    missing_scenario_keys: missingScenarioKeys,
    unexpected_scenario_keys: unexpectedScenarioKeys,
    passed_count: scenarios.length - failedScenarios.length,
    failed_count: failedScenarios.length,
    scenarios,
  };
}

const result = runCatalogIdentitySimulationSuite();

for (const item of result.scenarios) {
  const marker = item.scenario_status === "passed" ? "PASS" : "FAIL";
  console.log(`${marker} ${item.scenario_key} - ${item.detail}`);
}

console.log(
  `InstaComp catalog identity simulations: ${result.passed_count}/${result.scenario_count} passed; expected ${result.expected_scenario_count} scenarios.`,
);
console.log(
  `${result.scenario_coverage_status === "passed" ? "PASS" : "FAIL"} instacomp_catalog_identity_expected_scenario_count - expected ${result.expected_scenario_count}, found ${result.scenario_count}`,
);
console.log(
  `${result.scenario_key_coverage_status === "passed" ? "PASS" : "FAIL"} instacomp_catalog_identity_expected_scenario_keys - missing ${result.missing_scenario_keys.join(", ") || "none"}; unexpected ${result.unexpected_scenario_keys.join(", ") || "none"}`,
);

if (result.run_status !== "passed") {
  process.exitCode = 1;
}
