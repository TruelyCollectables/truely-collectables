import { readFileSync } from "node:fs";
import {
  buildInstaCompEvidenceIdentityDecision,
  type ChecklistRegistryLookupResult,
  type RegistryMatch,
} from "../src/lib/instacomp-learning-server";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const match: RegistryMatch = {
  identityId: "shedeur-exact",
  fingerprintSha256: "a".repeat(64),
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Panini",
  product: "Prizm",
  player: "Shedeur Sanders",
  year: "2025",
  setName: "Base",
  cardNumber: "301",
  parallel: "Silver Prizm",
  variation: null,
  serialRun: null,
  team: "Cleveland Browns",
  sport: "Football",
  league: "NFL",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: ["all visible hard facts matched"],
};

const exactResolution: ChecklistRegistryLookupResult = {
  status: "internal_exact_match",
  match,
  reasons: ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
  candidateCount: 1,
  coveredReleaseIds: ["release"],
  coveredVersionIds: ["version"],
  coveredSetIds: ["set"],
  sourceTier: "internal",
  externalLookupEligible: false,
  externalLookupAttempted: false,
};

const consensus = {
  trustedForIdentity: true,
  finalIdentity: {
    player: "Shedeur Sanders",
    year: "2025",
    brand: "Panini",
    setName: "Prizm",
    cardNumber: "301",
    parallel: "Silver Prizm",
    isAuto: false,
    isRelic: false,
  },
  councilReadiness: { status: "ready" },
  fieldDecisions: [
    { field: "player", status: "agreed", conflictingValues: [] },
    { field: "year", status: "agreed", conflictingValues: [] },
    { field: "brand", status: "agreed", conflictingValues: [] },
    { field: "setName", status: "agreed", conflictingValues: [] },
    { field: "cardNumber", status: "agreed", conflictingValues: [] },
    {
      field: "parallel",
      status: "catalog_referee",
      conflictingValues: [],
      sources: ["OpenAI", "Gemini", "InstaComp Checklist Registry"],
    },
  ],
};

const confirmed = buildInstaCompEvidenceIdentityDecision({
  resolution: exactResolution,
  consensus,
  hasBackImage: true,
  threshold: 0.95,
});
assert(confirmed.confirmed, "Exact evidence should confirm");
assert(confirmed.confidence === 1, "Complete exact evidence should score 1.0");

const frontOnly = buildInstaCompEvidenceIdentityDecision({
  resolution: exactResolution,
  consensus,
  hasBackImage: false,
  threshold: 0.95,
});
assert(!frontOnly.confirmed, "Front-only scans must not confirm");
assert(frontOnly.reviewReasons.includes("back_image_required"), "Expected back-image reason");

const conflict = buildInstaCompEvidenceIdentityDecision({
  resolution: exactResolution,
  consensus: {
    ...consensus,
    fieldDecisions: [
      ...consensus.fieldDecisions.filter((item) => item.field !== "cardNumber"),
      { field: "cardNumber", status: "review_required", conflictingValues: ["302"] },
    ],
  },
  hasBackImage: true,
  threshold: 0.95,
});
assert(!conflict.confirmed, "Critical conflicts must not confirm");
assert(
  conflict.reviewReasons.includes("critical_visible_evidence_conflict"),
  "Expected critical conflict reason",
);

const parallelConflict = buildInstaCompEvidenceIdentityDecision({
  resolution: exactResolution,
  consensus: {
    ...consensus,
    fieldDecisions: [
      ...consensus.fieldDecisions.filter((item) => item.field !== "parallel"),
      {
        field: "parallel",
        status: "review_required",
        conflictingValues: ["Red Prizm"],
      },
    ],
  },
  hasBackImage: true,
  threshold: 0.95,
});
assert(!parallelConflict.confirmed, "Parallel conflicts must not confirm");
assert(
  parallelConflict.reviewReasons.includes("parallel_not_independently_confirmed"),
  "Expected independent parallel evidence reason",
);

const internalMiss = buildInstaCompEvidenceIdentityDecision({
  resolution: {
    ...exactResolution,
    status: "internal_set_present_no_exact_match",
    match: null,
    externalLookupEligible: false,
    reasons: ["internal_set_present_but_no_unique_identity_matches_every_visible_fact"],
  },
  consensus,
  hasBackImage: true,
  threshold: 0.95,
});
assert(!internalMiss.confirmed, "Internal set-present misses must not confirm");

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
assert(
  !route.includes("buildInstaCompCuratedChecklistEvidence"),
  "Production scan route must not use benchmark/hardcoded checklist fallback",
);
assert(
  route.includes("resolveChecklistRegistry(registryProbeAi"),
  "Production route must resolve the internal checklist from the current bounded Registry probe",
);
assert(
  route.includes("identityDecision.confirmed"),
  "Comp and learning gates must use the evidence identity decision",
);
assert(
  route.includes("Promise.all([") &&
    route.includes("getPaddleOcr(images)") &&
    route.includes("getGoogleVisionOcr(images)"),
  "Both OCR providers must run in evidence-first mode",
);

console.log("InstaComp evidence-first regressions passed (13 assertions).");
