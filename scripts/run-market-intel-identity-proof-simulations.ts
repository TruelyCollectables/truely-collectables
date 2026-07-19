import assert from "node:assert/strict";
import {
  assertMarketIntelIdentityProofVerified,
  buildMarketIntelIdentityProofMetadata,
  canVerifyMarketIntelExactIdentity,
  isMarketIntelIdentityProofVerified,
  marketIntelIdentityProofMissingEvidence,
  type MarketIntelIdentityProofEvidence,
} from "../src/lib/market-intel-identity-proof.ts";

const completeEvidence: MarketIntelIdentityProofEvidence = {
  frontImageConfirmed: true,
  backImageConfirmed: true,
  slabLabelConfirmed: false,
  checklistConfirmed: true,
  cardNumberConfirmed: true,
  parallelConfirmed: true,
  serialNumberConfirmed: false,
  autographRelicConfirmed: false,
  noConflictingEvidence: true,
};

assert.equal(canVerifyMarketIntelExactIdentity(completeEvidence), true);
assert.deepEqual(marketIntelIdentityProofMissingEvidence(completeEvidence), []);

const verified = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: completeEvidence,
  notes: "Owner matched front, back, checklist, card number, and parallel.",
});
assert.equal(isMarketIntelIdentityProofVerified(verified), true);
assert.doesNotThrow(() => assertMarketIntelIdentityProofVerified(verified));

const frontOnly = {
  ...completeEvidence,
  backImageConfirmed: false,
  slabLabelConfirmed: false,
};
assert.equal(canVerifyMarketIntelExactIdentity(frontOnly), false);
assert.deepEqual(marketIntelIdentityProofMissingEvidence(frontOnly), [
  "back image or slab label",
]);
const suppressed = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: frontOnly,
});
assert.equal(suppressed.identity_proof_status, "verified_exact");
assert.equal(suppressed.identity_proof_operator_confirmed, false);
assert.equal(isMarketIntelIdentityProofVerified(suppressed), false);
assert.throws(
  () => assertMarketIntelIdentityProofVerified(suppressed),
  /back image or slab label/i,
);

const conflict = buildMarketIntelIdentityProofMetadata({
  status: "conflict_detected",
  evidence: { ...completeEvidence, noConflictingEvidence: false },
});
assert.equal(isMarketIntelIdentityProofVerified(conflict), false);
assert.throws(() => assertMarketIntelIdentityProofVerified(conflict));

console.log(
  JSON.stringify(
    {
      passed: true,
      gate: "tcos.identityProofGate.v1",
      verifiedExactRequires:
        "front + (back or slab) + checklist + card number + parallel + no conflicts",
      unverifiedPurchaseBlocked: true,
    },
    null,
    2,
  ),
);
