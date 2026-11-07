import assert from "node:assert/strict";
import {
  pendingDuplicateCandidateMatches,
  pendingDuplicateDecisionResolved,
  pendingDuplicateProtectionMatchKey,
} from "../src/lib/pending-duplicate-protection";

assert.equal(
  pendingDuplicateCandidateMatches({
    draftPricingGroupKey: "registry:abc",
    candidatePricingGroupKey: "registry:abc",
    draftTitle: "2025 Prizm Ice #144 Dominique Malonga",
    candidateTitle: "anything",
  }),
  true,
  "same permanent identity must match",
);

assert.equal(
  pendingDuplicateCandidateMatches({
    draftPricingGroupKey: "registry:ice",
    candidatePricingGroupKey: "registry:blue-velocity",
    draftTitle: "2025 Prizm #144 Dominique Malonga",
    candidateTitle: "2025 Prizm #144 Dominique Malonga",
  }),
  false,
  "different structured identities must never be overridden by title",
);

assert.equal(
  pendingDuplicateCandidateMatches({
    draftPricingGroupKey: "registry:ice",
    candidatePricingGroupKey: null,
    draftTitle: "2025 Prizm Ice Prizm Dominique Malonga #144 RC",
    candidateTitle: "2025 Prizm Ice Prizm Dominique Malonga #144 RC Listing",
  }),
  true,
  "new structured scans must still catch exact legacy-title inventory",
);

assert.equal(
  pendingDuplicateCandidateMatches({
    draftPricingGroupKey: null,
    candidatePricingGroupKey: null,
    draftTitle: "2025 Prizm Ice Prizm Dominique Malonga #144 RC",
    candidateTitle: "2025 Prizm Blue Velocity Prizm Dominique Malonga #144 RC",
  }),
  false,
  "different parallels must not legacy-title match",
);

assert.equal(
  pendingDuplicateCandidateMatches({
    draftPricingGroupKey: null,
    candidatePricingGroupKey: null,
    draftTitle: "2025 Prizm Silver Prizm Paige Bueckers #147 RC",
    candidateTitle: "2025 Prizm Ice Prizm Paige Bueckers #147 RC",
  }),
  false,
  "Silver and Ice must stay separate",
);

assert.equal(
  pendingDuplicateProtectionMatchKey({
    pricingGroupKey: "registry:abc",
    title: "same title",
  }),
  "registry:abc",
  "structured identity must be the decision key",
);

const legacyKey = pendingDuplicateProtectionMatchKey({
  pricingGroupKey: null,
  title: "2025 Prizm Ice Prizm Dominique Malonga #144 RC Card",
});
assert.equal(
  legacyKey,
  "legacy-title:2025 prizm ice prizm dominique malonga #144 rc",
  "legacy key must preserve parallel language",
);
assert.equal(
  pendingDuplicateDecisionResolved(
    { mode: "keep_separate", matchKey: legacyKey },
    legacyKey,
  ),
  true,
  "explicit separate decision should clear the gate for exactly that identity",
);
assert.equal(
  pendingDuplicateDecisionResolved(
    { mode: "keep_separate", matchKey: "registry:other" },
    "registry:abc",
  ),
  false,
  "a stale decision must not clear a different identity",
);

console.log("pending duplicate protection simulations: PASS");
