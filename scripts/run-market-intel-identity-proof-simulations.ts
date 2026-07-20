import assert from "node:assert/strict";
import {
  assertMarketIntelIdentityProofVerified,
  buildMarketIntelIdentityProofMetadata,
  canVerifyMarketIntelExactIdentity,
  isMarketIntelIdentityProofVerified,
  marketIntelIdentityProofMissingEvidence,
  type MarketIntelIdentityProofEvidence,
  type MarketIntelIdentityProofRequirements,
} from "../src/lib/market-intel-identity-proof";

const completeCoreEvidence: MarketIntelIdentityProofEvidence = {
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

const noExtraRequirements: MarketIntelIdentityProofRequirements = {
  serialNumbered: false,
  autograph: false,
  memorabilia: false,
};

assert.equal(
  canVerifyMarketIntelExactIdentity(completeCoreEvidence, noExtraRequirements),
  true,
);
assert.deepEqual(
  marketIntelIdentityProofMissingEvidence(completeCoreEvidence, noExtraRequirements),
  [],
);

const verified = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: completeCoreEvidence,
  requirements: noExtraRequirements,
  notes: "Owner matched front, back, checklist, card number, and parallel.",
});
assert.equal(isMarketIntelIdentityProofVerified(verified), true);
assert.doesNotThrow(() => assertMarketIntelIdentityProofVerified(verified));
assert.equal(verified.identity_proof_version, "tcos.identityProofGate.v2");

const frontOnly = {
  ...completeCoreEvidence,
  backImageConfirmed: false,
  slabLabelConfirmed: false,
};
assert.equal(
  canVerifyMarketIntelExactIdentity(frontOnly, noExtraRequirements),
  false,
);
assert.deepEqual(
  marketIntelIdentityProofMissingEvidence(frontOnly, noExtraRequirements),
  ["back image or slab label"],
);
const suppressed = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: frontOnly,
  requirements: noExtraRequirements,
});
assert.equal(suppressed.identity_proof_status, "review_required");
assert.equal(suppressed.identity_proof_operator_confirmed, false);
assert.equal(isMarketIntelIdentityProofVerified(suppressed), false);
assert.throws(
  () => assertMarketIntelIdentityProofVerified(suppressed),
  /back image or slab label/i,
);

const serialRequirements: MarketIntelIdentityProofRequirements = {
  serialNumbered: true,
  autograph: false,
  memorabilia: false,
};
assert.equal(
  canVerifyMarketIntelExactIdentity(completeCoreEvidence, serialRequirements),
  false,
);
assert.deepEqual(
  marketIntelIdentityProofMissingEvidence(
    completeCoreEvidence,
    serialRequirements,
  ),
  ["serial-number tier"],
);
const serialVerified = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: { ...completeCoreEvidence, serialNumberConfirmed: true },
  requirements: serialRequirements,
});
assert.equal(isMarketIntelIdentityProofVerified(serialVerified), true);

const autographRequirements: MarketIntelIdentityProofRequirements = {
  serialNumbered: false,
  autograph: true,
  memorabilia: false,
};
assert.equal(
  canVerifyMarketIntelExactIdentity(completeCoreEvidence, autographRequirements),
  false,
);
assert.deepEqual(
  marketIntelIdentityProofMissingEvidence(
    completeCoreEvidence,
    autographRequirements,
  ),
  ["autograph/relic status"],
);
const autographVerified = buildMarketIntelIdentityProofMetadata({
  status: "verified_exact",
  evidence: { ...completeCoreEvidence, autographRelicConfirmed: true },
  requirements: autographRequirements,
});
assert.equal(isMarketIntelIdentityProofVerified(autographVerified), true);

const conflict = buildMarketIntelIdentityProofMetadata({
  status: "conflict_detected",
  evidence: { ...completeCoreEvidence, noConflictingEvidence: false },
  requirements: noExtraRequirements,
});
assert.equal(isMarketIntelIdentityProofVerified(conflict), false);
assert.throws(() => assertMarketIntelIdentityProofVerified(conflict));

console.log(
  JSON.stringify(
    {
      passed: true,
      gate: "tcos.identityProofGate.v2",
      verifiedExactRequires:
        "front + (back or slab) + checklist + card number + parallel + no conflicts + conditional serial/auto/relic proof",
      unverifiedPurchaseBlocked: true,
    },
    null,
    2,
  ),
);
