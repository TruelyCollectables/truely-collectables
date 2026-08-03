import assert from "node:assert/strict";
import { evaluateSupplyChain } from "../src/lib/kingmaker-phase-19-third-party-supply-chain-risk";

const digest = "a".repeat(64);
const controls = {
  now: "2026-08-03T18:00:00.000Z",
  maxReviewAgeDays: 30,
  ownerApproved: true,
  releaseCertified: true,
  killSwitchReady: true,
};
const evidence = [{
  supplierId: "supplier-1",
  artifactId: "artifact-1",
  digest,
  signed: true,
  provenanceVerified: true,
  sbomPresent: true,
  accessScoped: true,
  incidentOpen: false,
  lastReviewedAt: "2026-08-01T00:00:00.000Z",
}];

const trusted = evaluateSupplyChain(evidence, controls);
assert.equal(trusted.verdict, "trusted");
assert.deepEqual(trusted.commands, []);
assert.equal(trusted.fingerprint, evaluateSupplyChain([...evidence], { ...controls }).fingerprint);

assert.equal(evaluateSupplyChain([], controls).verdict, "blocked");
assert.equal(evaluateSupplyChain([{ ...evidence[0], signed: false }], controls).verdict, "blocked");
assert.equal(evaluateSupplyChain([{ ...evidence[0], provenanceVerified: false }], controls).verdict, "blocked");
assert.equal(evaluateSupplyChain([{ ...evidence[0], incidentOpen: true }], controls).verdict, "blocked");
assert.equal(evaluateSupplyChain([{ ...evidence[0], sbomPresent: false }], controls).verdict, "quarantine");
assert.equal(evaluateSupplyChain([{ ...evidence[0], accessScoped: false }], controls).verdict, "quarantine");
assert.equal(evaluateSupplyChain([{ ...evidence[0], lastReviewedAt: "2025-01-01T00:00:00.000Z" }], controls).verdict, "quarantine");
assert.equal(evaluateSupplyChain(evidence, { ...controls, ownerApproved: false }).verdict, "blocked");
assert.equal(evaluateSupplyChain(evidence, { ...controls, maxReviewAgeDays: Number.NaN }).verdict, "blocked");
assert.equal(evaluateSupplyChain([evidence[0], { ...evidence[0], artifactId: "artifact-2" }], controls).verdict, "blocked");

console.log("KINGMAKER Phase 19 third-party supply-chain risk regressions passed");
