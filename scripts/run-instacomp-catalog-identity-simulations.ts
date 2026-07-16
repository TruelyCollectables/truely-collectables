import {
  buildInstaCompCuratedChecklistEvidence,
  catalogEvidenceToConsensusReferee,
} from "../src/lib/instacomp-curated-checklist";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  aggregateInstaCompCatalogProviderResults,
  attachInstaCompCatalogSourcePolicy,
  buildInstaCompCatalogLookupPlan,
  buildInstaCompCatalogCompGate,
  buildInstaCompCatalogEvidenceSnapshot,
  buildInstaCompCatalogOperatorReviewPacket,
  buildInstaCompCatalogProviderCompGate,
  evaluateInstaCompCatalogSourcePolicy,
  resolveInstaCompCatalogIdentity,
  type InstaCompCatalogCandidate,
  type InstaCompCatalogCandidateIdentity,
  type InstaCompCatalogIdentityInput,
  type InstaCompCatalogProviderResult,
  type InstaCompCatalogSourcePolicy,
} from "../src/lib/instacomp-catalog-identity";

const CATALOG_IDENTITY_EXPECTED_SCENARIO_KEYS = [
  "catalog_lookup_plan_filters_sources_before_comps",
  "catalog_source_policy_attaches_usage_to_candidates",
  "provider_result_aggregation_confirms_catalog_before_comps",
  "operator_review_packet_allows_money_claims_only_after_catalog_confirmed",
  "catalog_evidence_snapshot_persists_confirmed_identity_for_drafts",
  "unapproved_provider_candidates_are_ignored",
  "provider_failures_preserved_when_no_usable_candidates",
  "operator_review_packet_blocks_money_claims_when_review_required",
  "catalog_evidence_snapshot_preserves_review_blockers_for_drafts",
  "catalog_confirms_exact_parallel_before_comps",
  "catalog_confirmed_gate_uses_catalog_fields_for_exact_comps",
  "unapproved_source_forces_review_required",
  "no_approved_catalog_source_blocks_lookup_before_comps",
  "parallel_ambiguity_forces_targeted_review",
  "review_required_gate_blocks_exact_comp_trust",
  "serial_run_mismatch_forces_review_required",
  "missing_catalog_candidates_force_review_required",
  "curated_checklist_confirms_printed_outliers_over_base",
  "curated_checklist_confirms_opc_platinum_limited_red_over_base",
  "curated_checklist_stays_silent_for_unknown_cards",
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

const approvedSourcePolicy: InstaCompCatalogSourcePolicy = {
  source: "fixture_checklist",
  sourceLabel: "Fixture Checklist",
  sourceUrl: "https://example.test/catalog/2023-topps-chrome-update",
  apiAvailable: true,
  sourceUsageAllowed: true,
  commercialUseAllowed: true,
  storageAllowed: true,
  displayAllowed: true,
  cachingAllowed: true,
  attributionRequired: true,
  termsReviewedAt: "2026-07-15",
  variationCoverage: {
    baseCards: true,
    parallels: true,
    refractors: true,
    shortPrints: true,
    imageVariations: true,
    autographs: true,
    relics: true,
    serialNumberedRuns: true,
  },
};

const unapprovedSourcePolicy: InstaCompCatalogSourcePolicy = {
  ...approvedSourcePolicy,
  source: "unlicensed_fixture_checklist",
  sourceLabel: "Unlicensed Fixture Checklist",
  sourceUsageAllowed: false,
  commercialUseAllowed: false,
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

function catalogCandidateIdentity(
  overrides: Partial<InstaCompCatalogCandidateIdentity>,
): InstaCompCatalogCandidateIdentity {
  return {
    catalogId: "fixture-2023-tcu-usc17-gold-ref",
    sourceUrl: "https://example.test/catalog/2023-topps-chrome-update/usc17",
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

  const lookupPlan = buildInstaCompCatalogLookupPlan(target, [
    approvedSourcePolicy,
    unapprovedSourcePolicy,
    {
      ...approvedSourcePolicy,
      source: "no_api_fixture_checklist",
      sourceLabel: "No API Fixture Checklist",
      apiAvailable: false,
    },
  ]);
  scenarios.push(
    scenario(
      "catalog_lookup_plan_filters_sources_before_comps",
      "The lookup plan keeps only approved online card catalog sources and requires catalog identity before exact comps.",
      lookupPlan.status === "ready" &&
        lookupPlan.catalogBeforeCompsRequired &&
        lookupPlan.compSearchBlockedUntilCatalogResolved &&
        lookupPlan.approvedSources.length === 1 &&
        lookupPlan.rejectedSources.length === 2 &&
        lookupPlan.queryHints.includes("card number:USC17") &&
        lookupPlan.queryHints.includes("variation:Gold Refractor"),
      {
        status: lookupPlan.status,
        approvedSources: lookupPlan.approvedSources.map(
          (source) => source.source.source,
        ),
        rejectedSources: lookupPlan.rejectedSources.map((source) => ({
          source: source.source.source,
          reasons: source.reasons,
        })),
        catalogBeforeCompsRequired: lookupPlan.catalogBeforeCompsRequired,
        compSearchBlockedUntilCatalogResolved:
          lookupPlan.compSearchBlockedUntilCatalogResolved,
        queryHints: lookupPlan.queryHints,
      },
    ),
  );

  const attachedAllowedCandidates = attachInstaCompCatalogSourcePolicy(
    approvedSourcePolicy,
    [catalogCandidateIdentity({})],
  );
  const attachedRejectedCandidates = attachInstaCompCatalogSourcePolicy(
    unapprovedSourcePolicy,
    [catalogCandidateIdentity({ catalogId: "unapproved-candidate" })],
  );
  scenarios.push(
    scenario(
      "catalog_source_policy_attaches_usage_to_candidates",
      "Provider candidates inherit source labels, URLs, and TCOS commercial-use approval from the catalog source policy.",
      attachedAllowedCandidates[0]?.source === "fixture_checklist" &&
        attachedAllowedCandidates[0]?.sourceUsageAllowed === true &&
        attachedAllowedCandidates[0]?.sourceLabel === "Fixture Checklist" &&
        attachedRejectedCandidates[0]?.sourceUsageAllowed === false,
      {
        approvedCandidate: attachedAllowedCandidates[0],
        rejectedCandidate: attachedRejectedCandidates[0],
        rejectedPolicy: evaluateInstaCompCatalogSourcePolicy(
          unapprovedSourcePolicy,
        ),
      },
    ),
  );

  const providerGate = buildInstaCompCatalogProviderCompGate(
    { ...target, variation: null },
    [approvedSourcePolicy],
    [
      {
        source: "fixture_checklist",
        status: "fulfilled",
        candidates: [catalogCandidateIdentity({})],
        latencyMs: 42,
      },
    ],
  );
  scenarios.push(
    scenario(
      "provider_result_aggregation_confirms_catalog_before_comps",
      "Approved provider results are aggregated into catalog candidates, resolved, and then allowed through the exact-comp gate.",
      providerGate.status === "catalog_confirmed" &&
        providerGate.providerAggregation.status === "candidates_ready" &&
        providerGate.providerAggregation.candidates.length === 1 &&
        providerGate.providerAggregation.providerSummaries[0]
          ?.usableCandidateCount === 1 &&
        providerGate.exactCompSearchAllowed &&
        providerGate.compIdentity?.catalogSource === "fixture_checklist",
      {
        status: providerGate.status,
        aggregationStatus: providerGate.providerAggregation.status,
        providerSummaries: providerGate.providerAggregation.providerSummaries,
        exactCompSearchAllowed: providerGate.exactCompSearchAllowed,
        compIdentity: providerGate.compIdentity,
      },
    ),
  );

  const confirmedReviewPacket = buildInstaCompCatalogOperatorReviewPacket(
    { ...target, variation: null },
    [approvedSourcePolicy],
    [
      {
        source: "fixture_checklist",
        status: "fulfilled",
        candidates: [catalogCandidateIdentity({})],
      },
    ],
  );
  scenarios.push(
    scenario(
      "operator_review_packet_allows_money_claims_only_after_catalog_confirmed",
      "The operator review packet exposes the selected catalog match and allows exact comps, public claims, auto-price, and trade-value recommendations only after catalog confirmation.",
      confirmedReviewPacket.status === "catalog_confirmed" &&
        confirmedReviewPacket.operatorState === "ready_for_exact_comps" &&
        confirmedReviewPacket.exactCompSearchAllowed &&
        confirmedReviewPacket.publicListingClaimAllowed &&
        confirmedReviewPacket.autoPriceAllowed &&
        confirmedReviewPacket.tradeValueRecommendationAllowed &&
        confirmedReviewPacket.selectedMatch?.catalogId ===
          "fixture-2023-tcu-usc17-gold-ref" &&
        confirmedReviewPacket.selectedMatch.identity.parallel ===
          "Gold Refractor" &&
        confirmedReviewPacket.operatorAction.includes(
          "Catalog identity is confirmed",
        ) &&
        confirmedReviewPacket.safeUseBoundary.includes(
          "Catalog identity must be confirmed",
        ),
      {
        status: confirmedReviewPacket.status,
        operatorState: confirmedReviewPacket.operatorState,
        selectedMatch: confirmedReviewPacket.selectedMatch,
        exactCompSearchAllowed:
          confirmedReviewPacket.exactCompSearchAllowed,
        publicListingClaimAllowed:
          confirmedReviewPacket.publicListingClaimAllowed,
        autoPriceAllowed: confirmedReviewPacket.autoPriceAllowed,
        tradeValueRecommendationAllowed:
          confirmedReviewPacket.tradeValueRecommendationAllowed,
        operatorAction: confirmedReviewPacket.operatorAction,
        safeUseBoundary: confirmedReviewPacket.safeUseBoundary,
      },
    ),
  );

  const confirmedEvidenceSnapshot = buildInstaCompCatalogEvidenceSnapshot(
    { ...target, variation: null },
    [approvedSourcePolicy],
    [
      {
        source: "fixture_checklist",
        status: "fulfilled",
        candidates: [catalogCandidateIdentity({})],
      },
    ],
    "2026-07-15T22:30:00.000Z",
  );
  scenarios.push(
    scenario(
      "catalog_evidence_snapshot_persists_confirmed_identity_for_drafts",
      "The saved catalog evidence snapshot preserves confirmed identity, source attribution, action permissions, and audit flags for scan rows and draft handoff.",
      confirmedEvidenceSnapshot.schema ===
        "tcos.instacomp.catalogEvidence.v1" &&
        confirmedEvidenceSnapshot.capturedAt ===
          "2026-07-15T22:30:00.000Z" &&
        confirmedEvidenceSnapshot.catalogConfirmed &&
        confirmedEvidenceSnapshot.actionPermissions.exactCompSearchAllowed &&
        confirmedEvidenceSnapshot.actionPermissions.publicListingClaimAllowed &&
        confirmedEvidenceSnapshot.compIdentity?.catalogId ===
          "fixture-2023-tcu-usc17-gold-ref" &&
        confirmedEvidenceSnapshot.sourceAttribution?.source ===
          "fixture_checklist" &&
        confirmedEvidenceSnapshot.auditFlags.includes(
          "catalog identity confirmed from approved source",
        ),
      {
        schema: confirmedEvidenceSnapshot.schema,
        capturedAt: confirmedEvidenceSnapshot.capturedAt,
        catalogConfirmed: confirmedEvidenceSnapshot.catalogConfirmed,
        actionPermissions: confirmedEvidenceSnapshot.actionPermissions,
        compIdentity: confirmedEvidenceSnapshot.compIdentity,
        sourceAttribution: confirmedEvidenceSnapshot.sourceAttribution,
        auditFlags: confirmedEvidenceSnapshot.auditFlags,
      },
    ),
  );

  const mixedProviderAggregation = aggregateInstaCompCatalogProviderResults(
    target,
    [approvedSourcePolicy, unapprovedSourcePolicy],
    [
      {
        source: "unlicensed_fixture_checklist",
        status: "fulfilled",
        candidates: [catalogCandidateIdentity({ catalogId: "unapproved-match" })],
      },
      {
        source: "fixture_checklist",
        status: "fulfilled",
        candidates: [catalogCandidateIdentity({})],
      },
    ],
  );
  scenarios.push(
    scenario(
      "unapproved_provider_candidates_are_ignored",
      "Candidates returned by unapproved or unlicensed providers are preserved as ignored evidence but cannot enter the trusted exact-match pool.",
      mixedProviderAggregation.status === "candidates_ready" &&
        mixedProviderAggregation.candidates.length === 1 &&
        mixedProviderAggregation.candidates[0]?.catalogId ===
          "fixture-2023-tcu-usc17-gold-ref" &&
        mixedProviderAggregation.providerSummaries.some(
          (summary) =>
            summary.source === "unlicensed_fixture_checklist" &&
            summary.policyStatus === "rejected" &&
            summary.usableCandidateCount === 0 &&
            summary.reasons.some((reason) =>
              reason.includes("source is not approved"),
            ),
        ),
      {
        status: mixedProviderAggregation.status,
        usableCandidateCatalogIds: mixedProviderAggregation.candidates.map(
          (candidate) => candidate.catalogId,
        ),
        providerSummaries: mixedProviderAggregation.providerSummaries,
        providerWarnings: mixedProviderAggregation.providerWarnings,
      },
    ),
  );

  const failedProviderResults: InstaCompCatalogProviderResult[] = [
    {
      source: "fixture_checklist",
      status: "timeout",
      candidates: [],
      errorCode: "catalog_timeout",
    },
  ];
  const failedProviderGate = buildInstaCompCatalogProviderCompGate(
    target,
    [approvedSourcePolicy],
    failedProviderResults,
  );
  scenarios.push(
    scenario(
      "provider_failures_preserved_when_no_usable_candidates",
      "Approved provider lookup failures are preserved for operator review and keep trusted exact comps blocked when no usable catalog candidates remain.",
      failedProviderGate.status === "review_required" &&
        failedProviderGate.providerAggregation.status === "review_required" &&
        failedProviderGate.providerAggregation.reviewReasons.includes(
          "approved catalog providers returned no usable candidates",
        ) &&
        failedProviderGate.providerAggregation.providerSummaries[0]?.reasons.includes(
          "catalog provider returned no candidates",
        ) &&
        failedProviderGate.providerAggregation.providerSummaries[0]?.reasons.includes(
          "catalog provider lookup timed out",
        ) &&
        failedProviderGate.exactCompSearchAllowed === false &&
        failedProviderGate.reviewReasons.includes(
          "catalog identity unresolved before exact comps",
        ),
      {
        status: failedProviderGate.status,
        aggregationStatus: failedProviderGate.providerAggregation.status,
        reviewReasons: failedProviderGate.reviewReasons,
        providerSummaries:
          failedProviderGate.providerAggregation.providerSummaries,
        providerWarnings:
          failedProviderGate.providerAggregation.providerWarnings,
      },
    ),
  );

  const reviewPacket = buildInstaCompCatalogOperatorReviewPacket(
    target,
    [approvedSourcePolicy],
    failedProviderResults,
  );
  scenarios.push(
    scenario(
      "operator_review_packet_blocks_money_claims_when_review_required",
      "The operator review packet keeps exact comps, public claims, auto-price, and trade-value recommendations blocked when catalog identity needs review.",
      reviewPacket.status === "review_required" &&
        reviewPacket.operatorState === "needs_operator_review" &&
        reviewPacket.exactCompSearchAllowed === false &&
        reviewPacket.publicListingClaimAllowed === false &&
        reviewPacket.autoPriceAllowed === false &&
        reviewPacket.tradeValueRecommendationAllowed === false &&
        reviewPacket.providerWarnings.some((warning) =>
          warning.includes("catalog provider lookup timed out"),
        ) &&
        reviewPacket.reviewReasons.includes(
          "catalog identity unresolved before exact comps",
        ) &&
        reviewPacket.operatorAction.includes("approved catalog source"),
      {
        status: reviewPacket.status,
        operatorState: reviewPacket.operatorState,
        exactCompSearchAllowed: reviewPacket.exactCompSearchAllowed,
        publicListingClaimAllowed: reviewPacket.publicListingClaimAllowed,
        autoPriceAllowed: reviewPacket.autoPriceAllowed,
        tradeValueRecommendationAllowed:
          reviewPacket.tradeValueRecommendationAllowed,
        providerWarnings: reviewPacket.providerWarnings,
        reviewReasons: reviewPacket.reviewReasons,
        operatorAction: reviewPacket.operatorAction,
      },
    ),
  );

  const reviewEvidenceSnapshot = buildInstaCompCatalogEvidenceSnapshot(
    target,
    [approvedSourcePolicy],
    failedProviderResults,
    "2026-07-15T22:31:00.000Z",
  );
  scenarios.push(
    scenario(
      "catalog_evidence_snapshot_preserves_review_blockers_for_drafts",
      "The saved catalog evidence snapshot preserves Needs Review blockers and keeps comp identity, source attribution, public claims, auto-price, and trade value disabled.",
      reviewEvidenceSnapshot.schema === "tcos.instacomp.catalogEvidence.v1" &&
        reviewEvidenceSnapshot.catalogConfirmed === false &&
        reviewEvidenceSnapshot.actionPermissions.exactCompSearchAllowed ===
          false &&
        reviewEvidenceSnapshot.actionPermissions.publicListingClaimAllowed ===
          false &&
        reviewEvidenceSnapshot.actionPermissions.autoPriceAllowed === false &&
        reviewEvidenceSnapshot.actionPermissions
          .tradeValueRecommendationAllowed === false &&
        reviewEvidenceSnapshot.compIdentity === null &&
        reviewEvidenceSnapshot.sourceAttribution === null &&
        reviewEvidenceSnapshot.auditFlags.includes(
          "catalog identity requires operator review",
        ) &&
        reviewEvidenceSnapshot.auditFlags.includes(
          "exact comps blocked until catalog identity is confirmed",
        ) &&
        reviewEvidenceSnapshot.auditFlags.some((flag) =>
          flag.includes("catalog provider lookup timed out"),
        ),
      {
        schema: reviewEvidenceSnapshot.schema,
        catalogConfirmed: reviewEvidenceSnapshot.catalogConfirmed,
        actionPermissions: reviewEvidenceSnapshot.actionPermissions,
        compIdentity: reviewEvidenceSnapshot.compIdentity,
        sourceAttribution: reviewEvidenceSnapshot.sourceAttribution,
        auditFlags: reviewEvidenceSnapshot.auditFlags,
      },
    ),
  );

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

  const blockedLookupPlan = buildInstaCompCatalogLookupPlan(target, [
    unapprovedSourcePolicy,
  ]);
  scenarios.push(
    scenario(
      "no_approved_catalog_source_blocks_lookup_before_comps",
      "When no approved online catalog source is available, InstaComp records review_required and keeps exact comp trust blocked.",
      blockedLookupPlan.status === "review_required" &&
        blockedLookupPlan.approvedSources.length === 0 &&
        blockedLookupPlan.reviewReasons.includes(
          "no approved online card catalog source is available",
        ) &&
        blockedLookupPlan.compSearchBlockedUntilCatalogResolved,
      {
        status: blockedLookupPlan.status,
        approvedSources: blockedLookupPlan.approvedSources.length,
        rejectedSources: blockedLookupPlan.rejectedSources.map((source) => ({
          source: source.source.source,
          reasons: source.reasons,
        })),
        reviewReasons: blockedLookupPlan.reviewReasons,
        compSearchBlockedUntilCatalogResolved:
          blockedLookupPlan.compSearchBlockedUntilCatalogResolved,
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

  const outliersAi: InstaCompAiResult = {
    player: "Connor McDavid",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "Upper Deck SP Authentic Hockey",
    cardNumber: "O-8",
    parallel: "Base",
    serialNumber: null,
    team: "Edmonton Oilers",
    sport: "Hockey",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    conditionGuess: null,
    confidence: 0.96,
    notes: "Primary vision called it Base, but the back reads Outliers.",
  };
  const curatedOutliersEvidence = buildInstaCompCuratedChecklistEvidence({
    ai: outliersAi,
    externalOcrText: "OUTLIERS CONNOR MCDAVID O-8 SP AUTHENTIC HOCKEY",
    capturedAt: "2026-07-16T12:00:00.000Z",
  });
  const curatedOutliersReferee = catalogEvidenceToConsensusReferee(
    curatedOutliersEvidence,
  );
  scenarios.push(
    scenario(
      "curated_checklist_confirms_printed_outliers_over_base",
      "The starter TCOS curated checklist confirms a known printed Outliers card and exposes it as a consensus catalog referee instead of leaving the row as generic Base.",
      curatedOutliersEvidence?.status === "catalog_confirmed" &&
        curatedOutliersEvidence.catalogConfirmed &&
        curatedOutliersEvidence.compIdentity?.parallel === "Outliers" &&
        curatedOutliersEvidence.sourceAttribution?.source ===
          "tcos_curated_checklist" &&
        curatedOutliersReferee?.status === "catalog_confirmed" &&
        curatedOutliersReferee.identity?.parallel === "Outliers",
      {
        status: curatedOutliersEvidence?.status,
        compIdentity: curatedOutliersEvidence?.compIdentity,
        sourceAttribution: curatedOutliersEvidence?.sourceAttribution,
        referee: curatedOutliersReferee,
      },
    ),
  );

  const opcLimitedRedAi: InstaCompAiResult = {
    player: "Connor Bedard",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Upper Deck O-Pee-Chee Platinum",
    cardNumber: "201",
    parallel: "Base",
    serialNumber: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: null,
    confidence: 0.95,
    notes:
      "Primary vision called the card Base, but printed front text reads Limited Red.",
  };
  const opcLimitedRedEvidence = buildInstaCompCuratedChecklistEvidence({
    ai: opcLimitedRedAi,
    externalOcrText:
      "2024-25 O-PEE-CHEE PLATINUM CONNOR BEDARD ROOKIE LIMITED RED 201 CHICAGO BLACKHAWKS",
    capturedAt: "2026-07-16T12:05:00.000Z",
  });
  const opcLimitedRedReferee = catalogEvidenceToConsensusReferee(
    opcLimitedRedEvidence,
  );
  scenarios.push(
    scenario(
      "curated_checklist_confirms_opc_platinum_limited_red_over_base",
      "The starter TCOS curated checklist normalizes Upper Deck as the manufacturer, confirms O-Pee-Chee Platinum Limited Red, and overrides a generic Base read.",
      opcLimitedRedEvidence?.status === "catalog_confirmed" &&
        opcLimitedRedEvidence.catalogConfirmed &&
        opcLimitedRedEvidence.compIdentity?.setName === "O-Pee-Chee Platinum" &&
        opcLimitedRedEvidence.compIdentity?.parallel === "Limited Red" &&
        opcLimitedRedEvidence.selectedMatch?.catalogId ===
          "tcos-2024-25-o-pee-chee-platinum-201-limited-red" &&
        opcLimitedRedReferee?.status === "catalog_confirmed" &&
        opcLimitedRedReferee.identity?.setName === "O-Pee-Chee Platinum" &&
        opcLimitedRedReferee.identity?.parallel === "Limited Red",
      {
        status: opcLimitedRedEvidence?.status,
        compIdentity: opcLimitedRedEvidence?.compIdentity,
        selectedMatch: opcLimitedRedEvidence?.selectedMatch,
        referee: opcLimitedRedReferee,
      },
    ),
  );

  const unknownCuratedEvidence = buildInstaCompCuratedChecklistEvidence({
    ai: {
      ...outliersAi,
      player: "Unknown Player",
      year: "1999",
      setName: "Unknown Set",
      cardNumber: "999",
      parallel: "Base",
      notes: "No known curated checklist cues.",
    },
    externalOcrText: "UNKNOWN SET 999",
  });
  scenarios.push(
    scenario(
      "curated_checklist_stays_silent_for_unknown_cards",
      "The starter TCOS curated checklist does not invent a catalog referee for cards outside its known candidate set.",
      unknownCuratedEvidence === null,
      {
        evidence: unknownCuratedEvidence,
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
