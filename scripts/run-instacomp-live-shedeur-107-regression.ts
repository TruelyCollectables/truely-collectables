import {
  buildInstaCompMultiScannerConsensus,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

const scanIdentity = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Origins Football Base",
  cardNumber: "107",
  parallel: "Blue Foil",
  variation: "Rookie",
  serialNumber: "162/199",
  team: "Cleveland Browns",
  sport: "Football",
  league: "NFL",
  isRookie: true,
  isAuto: false,
  isRelic: false,
};

const checklistIdentity = {
  id: "shedeur-107-holo-blue-199",
  fingerprint_sha256: "a".repeat(64),
  canonical_key: "configuration=hobby|language_code=en",
  variation: "Rookie",
  autograph_status: "none",
  memorabilia_status: "none",
  configuration_exclusivity: "hobby",
  metadata: { languageCode: "en" },
  parallel: { name: "Holo Blue", serial_run: 199 },
};

const checklistRow = {
  card_number: "107",
  normalized_card_number: "107",
  variation: "Rookie",
  autograph_status: "none",
  memorabilia_status: "none",
  set: { name: "Base" },
  release: {
    product_name: "Panini Origins Football",
    release_year: "2025",
    season: "2025",
    manufacturer: { name: "Panini" },
    brand: { name: "Origins" },
    sport: { name: "Football" },
    league: { name: "NFL" },
  },
  players: [{ player: { canonical_name: "Shedeur Sanders" } }],
  teams: [{ team: { canonical_name: "Cleveland Browns" } }],
  identities: [checklistIdentity],
};

function reader(params: {
  id: string;
  label: string;
  family: string;
  parallel: string;
  kind?: "primary_vision" | "secondary_vision";
}): InstaCompConsensusReaderFinding {
  return {
    readerId: params.id,
    label: params.label,
    family: params.family,
    kind: params.kind || "secondary_vision",
    confidence: 0.99,
    weight: 1,
    identity: {
      ...scanIdentity,
      parallel: params.parallel,
    },
    evidence: [`${params.label} observed ${params.parallel}`],
  };
}

const exact = chooseRegistryMatch(scanIdentity, [checklistRow]);
equal(
  exact?.identityId,
  "shedeur-107-holo-blue-199",
  "Blue Foil must resolve to official Holo Blue /199",
);

equal(
  chooseRegistryMatch({ ...scanIdentity, cardNumber: "108" }, [checklistRow]),
  null,
  "wrong card number must fail closed",
);
equal(
  chooseRegistryMatch({ ...scanIdentity, parallel: "Red Foil" }, [checklistRow]),
  null,
  "wrong color must fail closed",
);
equal(
  chooseRegistryMatch({ ...scanIdentity, parallel: "Blue Wave Foil" }, [checklistRow]),
  null,
  "wrong finish must fail closed",
);
equal(
  chooseRegistryMatch({ ...scanIdentity, serialNumber: "162/99" }, [checklistRow]),
  null,
  "wrong serial denominator must fail closed",
);
equal(
  chooseRegistryMatch({ ...scanIdentity, player: "Cam Ward" }, [checklistRow]),
  null,
  "wrong player must fail closed",
);

const consensus = buildInstaCompMultiScannerConsensus({
  baseIdentity: scanIdentity,
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
    }),
  ],
  catalogReferee: {
    status: "catalog_confirmed",
    sourceLabel: "InstaComp Checklist Registry",
    catalogId: "shedeur-107-holo-blue-199",
    matchExplanation: "Official 2025 Panini Origins Football checklist identity.",
    identity: {
      ...scanIdentity,
      parallel: "Holo Blue",
      serialNumber: null,
      serialRun: "199",
    },
  },
});

assert(consensus.trustedForIdentity, consensus.reviewReasons.join(", "));
equal(consensus.finalIdentity.parallel, "Holo Blue", "official parallel name");
assert(
  consensus.fieldDecisions.some(
    (decision) =>
      decision.field === "parallel" &&
      decision.status === "catalog_referee" &&
      decision.conflictingValues.length === 0,
  ),
  "Blue Foil and Holo Blue must agree without hiding a conflict",
);

const wrongColorConsensus = buildInstaCompMultiScannerConsensus({
  baseIdentity: scanIdentity,
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
      parallel: "Red Foil",
    }),
  ],
  catalogReferee: {
    status: "catalog_confirmed",
    sourceLabel: "InstaComp Checklist Registry",
    catalogId: "shedeur-107-holo-blue-199",
    matchExplanation: "Official checklist candidate.",
    identity: {
      ...scanIdentity,
      parallel: "Holo Blue",
      serialNumber: null,
      serialRun: "199",
    },
  },
});

equal(
  wrongColorConsensus.trustedForIdentity,
  false,
  "Blue versus red evidence must never confirm",
);
equal(
  wrongColorConsensus.catalogReferee.status,
  "review_required",
  "conflicting checklist candidate must be quarantined",
);

console.log(
  "Shedeur #107 Holo Blue /199 real-card identity regression passed.",
);
