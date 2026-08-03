import {
  buildInstaCompEvidenceIdentityDecision,
  chooseRegistryMatch,
} from "../src/lib/instacomp-learning-server";
import {
  buildInstaCompMultiScannerConsensus,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

const baseIdentity = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Prizm Football",
  cardNumber: "301",
  parallel: "Blue Prizm",
  serialNumber: "12/199",
  team: "Cleveland Browns",
  sport: "Football",
  isRookie: true,
  isAuto: false,
  isRelic: false,
};

function checklistRow(identities: Array<Record<string, unknown>>) {
  return {
    card_number: "301",
    normalized_card_number: "301",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: { name: "Base Set" },
    release: {
      product_name: "Prizm Football",
      release_year: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Panini" },
      sport: { name: "Football" },
      league: { name: "NFL" },
    },
    players: [{ player: { canonical_name: "Shedeur Sanders" } }],
    teams: [{ team: { canonical_name: "Cleveland Browns" } }],
    identities,
  };
}

function identity(id: string, parallel: string, serialRun: number | null) {
  return {
    id,
    fingerprint_sha256: id.padEnd(64, "0").slice(0, 64),
    canonical_key: "configuration=∅|language_code=∅",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    configuration_exclusivity: null,
    metadata: {},
    parallel: { name: parallel, serial_run: serialRun },
  };
}

function reader(params: {
  id: string;
  label: string;
  family: string;
  parallel: string;
  brand?: string;
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
      ...baseIdentity,
      brand: params.brand || baseIdentity.brand,
      parallel: params.parallel,
    },
    evidence: [`${params.label} observed ${params.parallel}`],
  };
}

const catalogReferee = {
  status: "catalog_confirmed" as const,
  sourceLabel: "InstaComp Checklist Registry",
  catalogId: "shedeur-blue-199",
  matchExplanation: "Official checklist candidate.",
  identity: {
    ...baseIdentity,
    serialNumber: null,
    serialRun: "199",
  },
};

const registryMatch = {
  identityId: "shedeur-blue-199",
  fingerprintSha256: "a".repeat(64),
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Panini",
  product: "Prizm Football",
  player: "Shedeur Sanders",
  year: "2025",
  setName: "Base Set",
  cardNumber: "301",
  parallel: "Blue Prizm",
  variation: null,
  serialRun: 199,
  team: "Cleveland Browns",
  sport: "Football",
  league: "NFL",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: [],
};

const tests: Array<[string, () => void]> = [];
const test = (name: string, run: () => void) => tests.push([name, run]);

test("serial denominator cannot erase parallel finish", () => {
  const row = checklistRow([
    identity("blue-wave", "Blue Wave Prizm", 199),
    identity("blue", "Blue Prizm", 199),
  ]);

  equal(
    chooseRegistryMatch(baseIdentity, [row])?.identityId,
    "blue",
    "Blue must select only Blue",
  );
  equal(
    chooseRegistryMatch(
      { ...baseIdentity, parallel: "Blue Wave Prizm" },
      [row],
    )?.identityId,
    "blue-wave",
    "Blue Wave must select only Blue Wave",
  );
  equal(
    chooseRegistryMatch(baseIdentity, [checklistRow([
      identity("blue-wave-only", "Blue Wave Prizm", 199),
    ])]),
    null,
    "Incomplete Blue evidence must not become Blue Wave",
  );
  equal(
    chooseRegistryMatch(
      { ...baseIdentity, parallel: "Red Prizm" },
      [row],
    ),
    null,
    "Red evidence must not resolve to a Blue checklist identity",
  );
});

test("catalog cannot override conflicting visible colors", () => {
  const consensus = buildInstaCompMultiScannerConsensus({
    readers: [
      reader({
        id: "primary",
        label: "Primary OpenAI",
        family: "openai",
        parallel: "Blue Prizm",
        kind: "primary_vision",
      }),
      reader({
        id: "gemini",
        label: "Gemini",
        family: "gemini",
        parallel: "Red Prizm",
      }),
    ],
    baseIdentity,
    catalogReferee,
  });

  equal(consensus.trustedForIdentity, false, "color conflict must block identity");
  assert(
    consensus.reviewReasons.some((reason) => reason.includes("parallel")),
    "parallel conflict review reason missing",
  );
  equal(
    consensus.catalogReferee.status,
    "review_required",
    "catalog referee must be quarantined",
  );
});

test("two readers from one AI family are not independent", () => {
  const consensus = buildInstaCompMultiScannerConsensus({
    readers: [
      reader({
        id: "openai-primary",
        label: "OpenAI primary",
        family: "openai",
        parallel: "Blue Prizm",
        kind: "primary_vision",
      }),
      reader({
        id: "openai-backup",
        label: "OpenAI backup",
        family: "openai",
        parallel: "Blue Prizm",
      }),
    ],
    baseIdentity,
    catalogReferee,
  });

  equal(
    consensus.trustedForIdentity,
    false,
    "duplicate OpenAI passes must not satisfy independent parallel evidence",
  );
  equal(consensus.councilReadiness.independentReaderCount, 1, "family count");
});

test("two independent families plus checklist can confirm exact parallel", () => {
  const consensus = buildInstaCompMultiScannerConsensus({
    readers: [
      reader({
        id: "primary",
        label: "OpenAI",
        family: "openai",
        parallel: "Blue Prizm",
        kind: "primary_vision",
      }),
      reader({
        id: "gemini",
        label: "Gemini",
        family: "gemini",
        parallel: "Blue Prizm",
      }),
    ],
    baseIdentity,
    catalogReferee,
  });

  equal(consensus.trustedForIdentity, true, "independent agreement should confirm");
  const parallelDecision = consensus.fieldDecisions.find(
    (decision) => decision.field === "parallel",
  );
  equal(parallelDecision?.status, "catalog_referee", "parallel referee status");
  equal(parallelDecision?.conflictingValues.length, 0, "parallel conflicts");

  const identityDecision = buildInstaCompEvidenceIdentityDecision({
    resolution: {
      status: "internal_exact_match",
      match: registryMatch,
      reasons: [],
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

  equal(identityDecision.confirmed, true, identityDecision.reviewReasons.join(","));
});

test("parallel is mandatory for the 95 percent identity gate", () => {
  const consensus = buildInstaCompMultiScannerConsensus({
    readers: [
      reader({
        id: "primary",
        label: "OpenAI",
        family: "openai",
        parallel: "Blue Prizm",
        kind: "primary_vision",
      }),
      reader({
        id: "gemini",
        label: "Gemini",
        family: "gemini",
        parallel: "Blue Prizm",
      }),
    ],
    baseIdentity,
    catalogReferee,
  });
  const incompleteConsensus = {
    ...consensus,
    finalIdentity: { ...consensus.finalIdentity, parallel: undefined },
    fieldDecisions: consensus.fieldDecisions.filter(
      (decision) => decision.field !== "parallel",
    ),
  };

  const decision = buildInstaCompEvidenceIdentityDecision({
    resolution: {
      status: "internal_exact_match",
      match: registryMatch,
      reasons: [],
      candidateCount: 1,
      coveredReleaseIds: ["release"],
      coveredVersionIds: ["version"],
      coveredSetIds: ["set"],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    },
    consensus: incompleteConsensus,
    hasBackImage: true,
    threshold: 0.95,
  });

  equal(decision.confirmed, false, "missing parallel must block confirmation");
  assert(
    decision.reviewReasons.includes("parallel_not_independently_confirmed"),
    "missing parallel evidence reason",
  );
});

test("manufacturer or brand disagreement is a hard stop", () => {
  const consensus = buildInstaCompMultiScannerConsensus({
    readers: [
      reader({
        id: "primary",
        label: "OpenAI",
        family: "openai",
        parallel: "Blue Prizm",
        brand: "Panini",
        kind: "primary_vision",
      }),
      reader({
        id: "gemini",
        label: "Gemini",
        family: "gemini",
        parallel: "Blue Prizm",
        brand: "Topps",
      }),
    ],
    baseIdentity,
    catalogReferee: null,
  });

  equal(consensus.trustedForIdentity, false, "brand conflict must block identity");
  assert(
    consensus.reviewReasons.includes("multi_scanner_brand_disagreement"),
    "brand disagreement reason missing",
  );
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

console.log(
  `InstaComp identity firewall regressions: ${tests.length - failed}/${tests.length} passed.`,
);
if (failed) process.exitCode = 1;
