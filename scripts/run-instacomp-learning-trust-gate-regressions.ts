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
assert(trustedOperator.allowed, "Trusted identity may be owner-confirmed without retyping it");

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

console.log("InstaComp learning trust gate regressions passed (10 assertions).");
