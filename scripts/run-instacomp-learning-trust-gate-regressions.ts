import { readFileSync } from "node:fs";
import {
  decideInstaCompLearningPromotion,
  decideInstaCompOperatorConfirmation,
} from "../src/lib/instacomp-learning-server";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const trustedPayload = {
  ai: {
    player: "Cam Ward",
    year: "2025",
    brand: "Panini",
    setName: "Origins",
    cardNumber: "107",
    parallel: "Gold",
    serialNumber: "17/199",
  },
  consensus: {
    trustedForIdentity: true,
    finalIdentity: { serialNumber: "17/199" },
  },
  compSearchDecision: { allowed: true },
  checklistRegistry: {
    matched: true,
    identityId: "origins-107-gold-199",
  },
  catalogEvidence: {
    status: "catalog_confirmed",
    catalogConfirmed: true,
    selectedMatch: { catalogId: "origins-107-gold-199" },
  },
};

const trustedPromotion = decideInstaCompLearningPromotion(trustedPayload);
assert(trustedPromotion.allowed, "Trusted exact identity should promote to reusable knowledge");

const untrustedPromotion = decideInstaCompLearningPromotion({
  ...trustedPayload,
  consensus: { trustedForIdentity: false },
  compSearchDecision: { allowed: false },
});
assert(!untrustedPromotion.allowed, "Untrusted identity must not promote");
assert(
  untrustedPromotion.reviewReasons.includes("consensus_identity_not_trusted"),
  "Expected consensus trust failure reason",
);

const mismatchedPromotion = decideInstaCompLearningPromotion({
  ...trustedPayload,
  catalogEvidence: {
    ...trustedPayload.catalogEvidence,
    selectedMatch: { catalogId: "different-registry-identity" },
  },
});
assert(!mismatchedPromotion.allowed, "Disagreeing catalog identities must quarantine");

const trustedOperator = decideInstaCompOperatorConfirmation({
  payload: trustedPayload,
  corrections: {},
  status: "operator_confirmed",
});
assert(trustedOperator.allowed, "Trusted exact identity may be owner-confirmed without retyping it");

const booleanOnlyOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ai: trustedPayload.ai,
    consensus: trustedPayload.consensus,
    compSearchDecision: trustedPayload.compSearchDecision,
    catalogEvidence: { catalogConfirmed: true },
  },
  corrections: {},
  status: "operator_confirmed",
});
assert(
  !booleanOnlyOperator.allowed,
  "Boolean-only trust without matching Registry/catalog receipts must not promote",
);

const mismatchedOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ...trustedPayload,
    catalogEvidence: {
      ...trustedPayload.catalogEvidence,
      selectedMatch: { catalogId: "forged-different-identity" },
    },
  },
  corrections: {},
  status: "operator_confirmed",
});
assert(
  !mismatchedOperator.allowed,
  "Operator confirmation must reject disagreeing Registry and catalog IDs",
);

const blockedOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ...trustedPayload,
    consensus: { trustedForIdentity: false, finalIdentity: { serialNumber: "17/199" } },
    compSearchDecision: { allowed: false },
  },
  corrections: { player: "Cam Ward" },
  status: "operator_confirmed",
});
assert(!blockedOperator.allowed, "Untrusted identity requires complete explicit corrections");
assert(
  blockedOperator.missingCorrections.includes("serialNumber"),
  "Numbered cards require an explicit corrected serial number",
);

const explicitOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ...trustedPayload,
    consensus: { trustedForIdentity: false, finalIdentity: { serialNumber: "17/199" } },
    compSearchDecision: { allowed: false },
  },
  corrections: {
    player: "Cam Ward",
    year: "2025",
    brand: "Panini",
    setName: "Origins",
    cardNumber: "107",
    parallel: "Gold",
    serialNumber: "17/199",
  },
  status: "operator_confirmed",
});
assert(explicitOperator.allowed, "Complete owner-entered identity may promote");

const scanRoute = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
assert(
  scanRoute.includes("catalogEvidenceTrustedForLearning"),
  "Scan persistence must gate catalog evidence before automatic learning",
);
assert(
  scanRoute.includes("catalogCandidateEvidence"),
  "Rejected catalog evidence must remain candidate audit evidence",
);
assert(
  scanRoute.includes("consensus: input.consensus || null"),
  "Permanent scan ledger must retain consensus for database trust enforcement",
);
assert(
  scanRoute.includes("compSearchDecision: input.compSearchDecision || null"),
  "Permanent scan ledger must retain the comp-search identity decision",
);

const migration = readFileSync(
  "supabase/migrations/20260802224500_instacomp_learning_provenance_receipt.sql",
  "utf8",
);
assert(
  migration.includes("tcos_instacomp_payload_exact_identity_trusted"),
  "Database gate must require a complete exact identity trust receipt",
);
assert(
  migration.includes("checklistRegistry,identityId") &&
    migration.includes("catalogEvidence,selectedMatch,catalogId"),
  "Database receipt must bind Registry and catalog identity IDs",
);

const ownerConvergenceMarkers = [
  "alter function public.tcos_instacomp_payload_exact_identity_trusted(jsonb)\n  owner to current_user;",
  "alter function public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)\n  owner to current_user;",
  "alter function public.tcos_instacomp_enforce_observation_identity_trust()\n  owner to current_user;",
  "alter function public.tcos_instacomp_enforce_cache_identity_trust()\n  owner to current_user;",
];
assert(
  ownerConvergenceMarkers.every((marker) => migration.includes(marker)),
  "Production reruns must converge the complete SECURITY DEFINER owner chain",
);
const firstBackfillStatement = migration.indexOf(
  "create temporary table instacomp_learning_provenance_impacted_entries",
);
assert(
  firstBackfillStatement > 0 &&
    ownerConvergenceMarkers.every(
      (marker) => migration.indexOf(marker) < firstBackfillStatement,
    ),
  "Function owners must converge before any trigger-backed backfill executes",
);

const payloadOwnerIndex = migration.indexOf(ownerConvergenceMarkers[0]);
const observationDefinitionIndex = migration.indexOf(
  "create or replace function public.tcos_instacomp_observation_exact_identity_trusted(",
);
const observationOwnerIndex = migration.indexOf(ownerConvergenceMarkers[1]);
const observationEnforcerDefinitionIndex = migration.indexOf(
  "create or replace function public.tcos_instacomp_enforce_observation_identity_trust()",
);
const observationEnforcerOwnerIndex = migration.indexOf(ownerConvergenceMarkers[2]);
const observationTriggerIndex = migration.indexOf(
  "drop trigger if exists tcos_instacomp_observation_identity_trust_gate",
);
const cacheEnforcerOwnerIndex = migration.indexOf(ownerConvergenceMarkers[3]);
const cacheTriggerIndex = migration.indexOf(
  "drop trigger if exists tcos_instacomp_cache_identity_trust_gate",
);
assert(
  payloadOwnerIndex > 0 &&
    payloadOwnerIndex < observationDefinitionIndex &&
    observationOwnerIndex > observationDefinitionIndex &&
    observationOwnerIndex < observationEnforcerDefinitionIndex &&
    observationEnforcerOwnerIndex > observationEnforcerDefinitionIndex &&
    observationEnforcerOwnerIndex < observationTriggerIndex &&
    cacheEnforcerOwnerIndex > 0 &&
    cacheEnforcerOwnerIndex < cacheTriggerIndex,
  "Each preserved ACL must converge before PostgreSQL validates or installs its dependent function chain",
);

console.log("InstaComp learning trust gate regressions passed (17 assertions).");
