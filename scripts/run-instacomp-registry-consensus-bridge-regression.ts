import {
  buildInstaCompMultiScannerConsensus,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";
import { catalogEvidenceToConsensusReferee } from "../src/lib/instacomp-curated-checklist";
import {
  buildChecklistRegistryCatalogEvidence,
  type RegistryMatch,
} from "../src/lib/instacomp-learning-server";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const visibleIdentity = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "2025 Panini Origins Football",
  cardNumber: "107",
  parallel: "Blue Foil",
  serialNumber: "162/199",
  team: "Cleveland Browns",
  sport: "Football",
  isRookie: true,
  isAuto: false,
  isRelic: false,
};

const registryMatch: RegistryMatch = {
  identityId: "origins-shedeur-107-holo-blue-199",
  fingerprintSha256: "fixture-fingerprint",
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Origins",
  product: "2025 Panini Origins Football",
  player: "Shedeur Sanders",
  year: "2025",
  setName: "Base - Rookies",
  cardNumber: "107",
  parallel: "Holo Blue",
  variation: "Rookie",
  serialRun: 199,
  team: "Cleveland Browns",
  sport: "Football",
  league: "NFL",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: [
    "manufacturer Panini",
    "product 2025 Panini Origins Football",
    "set Base - Rookies",
    "parallel Holo Blue",
    "serial run /199",
  ],
};

function reader(params: {
  id: string;
  label: string;
  family: string;
  parallel: string;
  kind: "primary_vision" | "secondary_vision";
}): InstaCompConsensusReaderFinding {
  return {
    readerId: params.id,
    label: params.label,
    family: params.family,
    kind: params.kind,
    confidence: 0.99,
    weight: 1,
    identity: { ...visibleIdentity, parallel: params.parallel },
    evidence: [`${params.label} observed ${params.parallel}`],
  };
}

const evidence = buildChecklistRegistryCatalogEvidence(registryMatch);
assert(evidence.status === "catalog_confirmed", "Registry evidence was not confirmed.");
assert(
  evidence.compIdentity?.brand === "Panini",
  `Consensus brand must use manufacturer Panini, received ${evidence.compIdentity?.brand}`,
);
assert(
  evidence.compIdentity?.setName === "2025 Panini Origins Football",
  `Consensus set must use the release product, received ${evidence.compIdentity?.setName}`,
);
assert(
  evidence.selectedMatch?.identity.parallel === "Holo Blue",
  "Registry parallel was not preserved.",
);

const referee = catalogEvidenceToConsensusReferee(evidence);
assert(referee?.status === "catalog_confirmed", "Registry referee was not confirmed.");

const consensus = buildInstaCompMultiScannerConsensus({
  baseIdentity: visibleIdentity,
  readers: [
    reader({
      id: "openai-primary",
      label: "OpenAI primary",
      family: "openai",
      parallel: "Blue Foil",
      kind: "primary_vision",
    }),
    reader({
      id: "gemini-secondary",
      label: "Gemini secondary",
      family: "gemini",
      parallel: "Holo Blue",
      kind: "secondary_vision",
    }),
  ],
  catalogReferee: referee,
});

assert(
  consensus.catalogReferee.status === "catalog_confirmed",
  `Registry referee was quarantined: ${consensus.reviewReasons.join(", ")}`,
);
assert(
  consensus.trustedForIdentity,
  `Exact Registry-backed identity was not trusted: ${consensus.reviewReasons.join(", ")}`,
);
assert(consensus.finalIdentity.brand === "Panini", "Final manufacturer/brand changed.");
assert(
  consensus.finalIdentity.setName === "2025 Panini Origins Football",
  "Final product/set changed.",
);
assert(
  consensus.finalIdentity.parallel === "Holo Blue",
  "Final parallel did not use the official checklist name.",
);

console.log("InstaComp Registry-to-consensus bridge regression passed.");
