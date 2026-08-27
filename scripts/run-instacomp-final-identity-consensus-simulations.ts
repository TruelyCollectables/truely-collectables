import assert from "node:assert/strict";
import { applyInstaCompRegistryFastLane, buildInstaCompMultiScannerConsensus } from "../src/lib/instacomp-consensus";
import { buildChecklistRegistryCatalogEvidence, buildInstaCompEvidenceIdentityDecision } from "../src/lib/instacomp-learning-server";
import { catalogEvidenceToConsensusReferee } from "../src/lib/instacomp-curated-checklist";
import { instaCompAiLocalScanToAi } from "../src/lib/instacomp-ai-local";

const iceMatch = {
  identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
  fingerprintSha256: "1".repeat(64),
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Panini",
  product: "2025 Panini Prizm WNBA",
  player: "Dominique Malonga",
  year: "2025",
  setName: "Base",
  cardNumber: "116",
  parallel: "Prizms Ice",
  variation: null,
  serialRun: null,
  team: null,
  sport: "Basketball",
  league: "WNBA",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: ["exact registry"],
};
const iceCatalog = buildChecklistRegistryCatalogEvidence(iceMatch);
const iceReferee = catalogEvidenceToConsensusReferee(iceCatalog);
const basicEscalation = applyInstaCompRegistryFastLane(
  { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "escalated_multi_ai", councilMode: "full_council", riskTier: "high", runSecondaryVision: false, reasons: ["printed_variant_signal_needs_second_reader"], scannerPlan: ["primary_ai_vision"], explanation: "basic tier disabled paid secondary" },
  iceMatch.identityId,
);
assert.equal(basicEscalation.runSecondaryVision, false);
assert.equal(basicEscalation.speedLane, "fast_lane");

const iceConsensus = buildInstaCompMultiScannerConsensus({
  readers: [
    {
      readerId: "primary",
      label: "Primary local Qwen",
      kind: "primary_vision",
      family: "instacomp_internal",
      identity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", sport: "Basketball", isAuto: false, isRelic: false },
      confidence: 0.98,
      evidence: ["front/back model"],
    },
    {
      readerId: "deterministic",
      label: "Apple Vision/OpenCV deterministic evidence",
      kind: "ocr_printed_evidence",
      family: "instacomp_local_deterministic",
      identity: { year: "2025", brand: "Panini", cardNumber: "116", parallel: "Cracked Ice Prizm" },
      confidence: 0.99,
      evidence: ["OpenCV front pattern: cracked_ice"],
    },
  ],
  baseIdentity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", sport: "Basketball", isAuto: false, isRelic: false },
  catalogReferee: iceReferee,
  escalation: basicEscalation,
});
console.log("ICE_CONSENSUS_DEBUG=" + JSON.stringify(iceConsensus, null, 2));
assert.equal(iceConsensus.trustedForIdentity, true);
assert.equal(iceConsensus.catalogReferee.status, "catalog_confirmed");

const baseMatch = { ...iceMatch, identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", fingerprintSha256: "2".repeat(64), player: "Sonia Citron", cardNumber: "122", parallel: "Base" };
const baseCatalog = buildChecklistRegistryCatalogEvidence(baseMatch);
const baseConsensus = buildInstaCompMultiScannerConsensus({
  readers: [{
    readerId: "primary-base",
    label: "Primary local Qwen",
    kind: "primary_vision",
    family: "instacomp_internal",
    identity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "Base", cardNumber: "122", parallel: "Base", sport: "Basketball", isAuto: false, isRelic: false },
    confidence: 0.98,
    evidence: ["2025 Panini Prizm WNBA product line; no named surface treatment observed"],
  }],
  baseIdentity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "Base", cardNumber: "122", parallel: "Base", sport: "Basketball", isAuto: false, isRelic: false },
  catalogReferee: catalogEvidenceToConsensusReferee(baseCatalog),
  escalation: { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "fast_lane", councilMode: "fast_lane_council", riskTier: "low", runSecondaryVision: false, reasons: [], scannerPlan: [], explanation: "test" },
});
assert.equal(baseConsensus.trustedForIdentity, true);
assert.equal(baseConsensus.catalogReferee.status, "catalog_confirmed");
const baseDecision = buildInstaCompEvidenceIdentityDecision({
  resolution: { status: "internal_exact_match", match: baseMatch, reasons: [], candidateCount: 1, coveredReleaseIds: ["r"], coveredVersionIds: ["v"], coveredSetIds: ["s"], sourceTier: "internal", externalLookupEligible: false, externalLookupAttempted: false },
  consensus: baseConsensus,
  hasBackImage: true,
  threshold: 0.95,
});
assert.equal(baseDecision.confirmed, true);
assert.ok(baseDecision.confidence >= 0.95);

const local = instaCompAiLocalScanToAi({
  schema_version: "tcos.instacomp-ai.scan.v1",
  scan_id: "11111111-1111-4111-8111-111111111111",
  status: "trusted_memory_match",
  pricing_allowed: true,
  learning_allowed: true,
  trusted_identity: { year: "2025", manufacturer: "Panini", set_name: "Base", player: "Dominique Malonga", card_number: "116", parallel: "Prizms Ice" },
  local_vision: { identity_hints: { year: "2025", manufacturer: "Panini", card_number: "116", parallel: "Cracked Ice Prizm" }, front: { pattern: { label: "cracked_ice" } } },
  checklist: { outcome: "exact_match", identity_id: iceMatch.identityId, source_receipts: [`registry_fingerprint:${iceMatch.fingerprintSha256}`], reasons: [] },
  next_action: "verified",
} as any);
assert.ok(local);
assert.equal(local?.internalChecklistIdentityId, iceMatch.identityId);
assert.equal(local?.internalChecklistFingerprintSha256, iceMatch.fingerprintSha256);
assert.equal((local?.internalDeterministicIdentity as any)?.parallel, "Cracked Ice Prizm");
console.log("PASS final InstaComp identity consensus simulations");
