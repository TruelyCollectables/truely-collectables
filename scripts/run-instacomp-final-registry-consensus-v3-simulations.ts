import assert from "node:assert/strict";

import {
  buildChecklistRegistryCatalogEvidence,
  buildInstaCompEvidenceIdentityDecision,
  type RegistryMatch,
} from "../src/lib/instacomp-learning-server";
import { catalogEvidenceToConsensusReferee } from "../src/lib/instacomp-curated-checklist";
import {
  applyInstaCompRegistryFastLane,
  buildInstaCompMultiScannerConsensus,
  type InstaCompConsensusIdentity,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";

const baseMatch: RegistryMatch = {
  identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
  fingerprintSha256: "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Prizm",
  product: "2025 Panini Prizm WNBA",
  player: "Sonia Citron",
  year: "2025",
  setName: "Base",
  cardNumber: "122",
  parallel: "Base",
  variation: null,
  serialRun: null,
  team: "Washington Mystics",
  sport: "Basketball",
  league: "WNBA",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: ["synthetic exact Registry Base match"],
};

const iceMatch: RegistryMatch = {
  ...baseMatch,
  identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
  fingerprintSha256: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
  player: "Dominique Malonga",
  cardNumber: "116",
  parallel: "Prizms Ice",
  matchedEvidence: ["synthetic exact Registry Ice match"],
};

const groovyMatch: RegistryMatch = {
  ...baseMatch,
  identityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
  fingerprintSha256: "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
  player: "Sonia Citron",
  cardNumber: "13",
  setName: "Groovy",
  parallel: "Base",
  matchedEvidence: ["synthetic exact Registry Groovy match"],
};

function primaryReader(identity: InstaCompConsensusIdentity, evidence: string[]): InstaCompConsensusReaderFinding {
  return {
    readerId: "primary",
    label: "InstaComp internal",
    kind: "primary_vision",
    family: "instacomp_internal",
    identity,
    confidence: 0.98,
    evidence,
  };
}

function deterministicReader(identity: InstaCompConsensusIdentity, evidence: string[]): InstaCompConsensusReaderFinding {
  return {
    readerId: "local-deterministic",
    label: "Apple Vision/OpenCV",
    kind: "ocr_printed_evidence",
    family: "instacomp_local_deterministic",
    identity,
    confidence: 1,
    evidence,
  };
}

function exactConsensus(match: RegistryMatch, readers: InstaCompConsensusReaderFinding[]) {
  const catalogEvidence = buildChecklistRegistryCatalogEvidence(match);
  const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
  const escalation = applyInstaCompRegistryFastLane(
    {
      schema: "tcos.instacomp.consensusEscalation.v1",
      speedLane: "escalated_multi_ai",
      councilMode: "full_council",
      riskTier: "high",
      runSecondaryVision: false,
      reasons: ["basic_local_first"],
      scannerPlan: ["primary_ai_vision", "external_ocr_printed_evidence"],
      explanation: "Basic tier local-first test.",
    },
    match.identityId,
  );
  const consensus = buildInstaCompMultiScannerConsensus({
    readers,
    baseIdentity: readers[0]?.identity || {},
    catalogReferee,
    escalation,
  });
  const decision = buildInstaCompEvidenceIdentityDecision({
    resolution: {
      status: "internal_exact_match",
      match,
      reasons: ["test_exact_registry_match"],
      candidateCount: 1,
      coveredReleaseIds: ["release"],
      coveredVersionIds: ["version"],
      coveredSetIds: ["set"],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    },
    consensus,
    hasBackImage: true,
    threshold: 0.95,
  });
  return { consensus, decision };
}

const base = exactConsensus(baseMatch, [
  primaryReader(
    {
      player: "Sonia Citron",
      year: "2025",
      brand: "Panini",
      setName: "Base",
      cardNumber: "122",
      parallel: "Base",
      isAuto: false,
      isRelic: false,
    },
    ["ordinary white background design; no explicit parallel or foil claim"],
  ),
  deterministicReader(
    { year: "2025", brand: "Panini", cardNumber: "122" },
    ["Apple Vision printed card number 122"],
  ),
]);
assert.equal(base.consensus.trustedForIdentity, true);
assert.equal(base.consensus.catalogReferee.status, "catalog_confirmed");
assert.equal(base.decision.confirmed, true);
assert.ok(base.decision.confidence >= 0.95);

const ice = exactConsensus(iceMatch, [
  primaryReader(
    {
      player: "Dominique Malonga",
      year: "2025",
      brand: "Panini",
      setName: "Base",
      cardNumber: "116",
      parallel: "Prizms Ice",
      isAuto: false,
      isRelic: false,
    },
    ["Parallel evidence: Prizms Ice"],
  ),
  deterministicReader(
    { year: "2025", brand: "Panini", cardNumber: "116" },
    ["OpenCV front pattern: cracked ice"],
  ),
]);
assert.equal(ice.consensus.trustedForIdentity, true);
assert.equal(ice.consensus.catalogReferee.status, "catalog_confirmed");
assert.equal(ice.decision.confirmed, true);
assert.ok(ice.decision.confidence >= 0.95);

const groovy = exactConsensus(groovyMatch, [
  primaryReader(
    {
      player: "Sonia Citron",
      year: "2025",
      brand: "Panini",
      setName: "PRIZM",
      cardNumber: "13",
      parallel: "Base",
      isAuto: false,
      isRelic: false,
    },
    ["Product line: Panini Prizm"],
  ),
  deterministicReader(
    { year: "2025", brand: "Panini", cardNumber: "13" },
    ["Apple Vision front text includes GROOVY"],
  ),
]);
assert.equal(groovy.consensus.trustedForIdentity, true);
assert.equal(groovy.consensus.finalIdentity.setName, "Groovy");
assert.equal(groovy.decision.confirmed, true);
assert.ok(groovy.decision.confidence >= 0.95);

console.log("PASS final Registry/consensus v3 Base + Ice + Groovy simulations");
