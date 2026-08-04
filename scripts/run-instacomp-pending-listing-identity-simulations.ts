import assert from "node:assert/strict";
import { buildPendingListingIdentity } from "../src/lib/instacomp-pending-listing-identity";
import type { InstaCompChecklistFirstDecision } from "../src/lib/instacomp-checklist-first";

const exactDecision: InstaCompChecklistFirstDecision = {
  status: "exact_match",
  aiRequired: false,
  match: {
    identityId: "registry-identity-1",
    fingerprintSha256: "abc123",
    year: "2024",
    manufacturer: "Panini",
    brand: "Prizm",
    product: "Prizm Football",
    setName: "Rookie Autographs",
    cardNumber: "125",
    player: "Example Player",
    team: "Denver Broncos",
    sport: "Football",
    league: "NFL",
    serialRun: 10,
    isAuto: true,
    isRelic: true,
    parallel: "Gold",
    variation: "Gold Auto Memorabilia",
  },
  candidates: [],
  reasons: ["checklist_exact_match"],
};

const identified = buildPendingListingIdentity({
  input: {
    year: "2024",
    manufacturer: "Panini",
    cardNumber: "125",
    player: "Example Player",
    serialNumber: "07/10",
    isAuto: true,
    isRelic: true,
    parallel: "Gold",
  },
  decision: exactDecision,
});

assert.equal(identified.status, "identified");
assert.equal(identified.aiIdentificationRequired, false);
assert.equal(identified.registryIdentityId, "registry-identity-1");
assert.equal(identified.lockedFields.serialRun, 10);
assert.equal(identified.lockedFields.isAuto, true);
assert.equal(identified.lockedFields.isRelic, true);
assert.equal(identified.lockedFields.parallel, "Gold");

const reviewDecision: InstaCompChecklistFirstDecision = {
  status: "review_required",
  aiRequired: true,
  match: null,
  candidates: [],
  reasons: ["multiple_checklist_variants_match"],
};

const review = buildPendingListingIdentity({
  input: {
    year: "2024",
    manufacturer: "Panini",
    cardNumber: "125",
    player: "Example Player",
  },
  decision: reviewDecision,
});

assert.equal(review.status, "review_required");
assert.equal(review.aiIdentificationRequired, true);
assert.equal(review.registryIdentityId, null);
assert.equal(review.lockedFields.player, null);

console.log("InstaComp pending-listing identity simulations passed.");
