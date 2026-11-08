import assert from "node:assert/strict";
import {
  buildInstaCompMultiScannerConsensus,
  buildInstaCompReaderFindingFromAi,
  type InstaCompConsensusCatalogReferee,
} from "../src/lib/instacomp-consensus";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

let sequence = 0;

function registryIdentity(parallel = "Base", serialRun: number | null = null) {
  sequence += 1;
  return {
    id: `identity-${sequence}`,
    fingerprint_sha256: `${sequence}`.padStart(64, "0"),
    canonical_key: "language_code=∅|configuration=∅",
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    configuration_exclusivity: null,
    metadata: {},
    parallel: {
      name: parallel,
      serial_run: serialRun,
    },
  };
}

function registryCard(params: {
  setName: string;
  cardNumber: string;
  player: string;
  team: string;
  season?: string;
  product?: string;
  identities?: ReturnType<typeof registryIdentity>[];
}) {
  return {
    id: `card-${params.cardNumber}-${sequence}`,
    card_number: params.cardNumber,
    normalized_card_number: params.cardNumber.toLowerCase().replace(/[\s-]/g, ""),
    variation: null,
    autograph_status: "non-auto",
    memorabilia_status: "non-memorabilia",
    set: {
      id: `set-${params.setName}`,
      name: params.setName,
      normalized_name: params.setName.toLowerCase(),
    },
    release: {
      id: "release-upper-deck-series-1",
      product_name: params.product || "Upper Deck Series 1",
      release_year: null,
      season: params.season || "2024-25",
      manufacturer: { name: "Upper Deck" },
      brand: { name: "Upper Deck" },
      sport: { name: "Hockey" },
      league: { name: "NHL" },
    },
    players: [{ display_order: 0, player: { canonical_name: params.player } }],
    teams: [{ display_order: 0, team: { canonical_name: params.team } }],
    identities: params.identities || [registryIdentity()],
  };
}

function ai(overrides: Record<string, unknown> = {}) {
  return {
    player: "Lane Hutson",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Upper Deck Series 1 - Young Guns",
    cardNumber: "229",
    parallel: "Young Guns",
    serialNumber: null,
    gradingCompany: null,
    gradeValue: null,
    certificationNumber: null,
    certificationLookupUrl: null,
    gradingEvidence: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Near Mint",
    confidence: 0.98,
    notes:
      "Young Guns is the printed subset name. No foil, color, clear stock, serial stamp, or other physical parallel cue is visible.",
    ...overrides,
  };
}

function catalogReferee(identity: Record<string, unknown>) {
  return {
    status: "catalog_confirmed",
    identity,
    sourceLabel: "InstaComp Checklist Registry",
    catalogId: `catalog-${sequence}`,
    matchExplanation: "One active private Registry identity matched.",
  } satisfies InstaCompConsensusCatalogReferee;
}

const youngGunsCatalog = catalogReferee({
  player: "Lane Hutson",
  year: "2024-25",
  brand: "Upper Deck",
  setName: "Upper Deck Series 1",
  registrySetName: "Young Guns",
  cardNumber: "229",
  parallel: "Base",
  serialRun: null,
  team: "Montreal Canadiens",
  sport: "Hockey",
  isAuto: false,
  isRelic: false,
});

const youngGunsConsensus = buildInstaCompMultiScannerConsensus({
  readers: [
    buildInstaCompReaderFindingFromAi({
      readerId: "primary",
      label: "Primary vision",
      kind: "primary_vision",
      family: "openai",
      ai: ai({ year: "2024", parallel: "Young Guns" }),
      evidence: ["front/back image pass"],
    }),
    buildInstaCompReaderFindingFromAi({
      readerId: "printed",
      label: "Printed evidence guard",
      kind: "ocr_printed_evidence",
      family: "openai",
      ai: ai({ year: "2024", parallel: "Young Guns" }),
      evidence: ["vision-only printed evidence guard"],
    }),
  ],
  baseIdentity: ai({ year: "2024", parallel: "Young Guns" }),
  catalogReferee: youngGunsCatalog,
  escalation: {
    schema: "tcos.instacomp.consensusEscalation.v1",
    speedLane: "fast_lane",
    councilMode: "fast_lane_council",
    riskTier: "low",
    runSecondaryVision: false,
    reasons: [],
    scannerPlan: ["primary_vision", "checklist_registry_referee"],
    explanation: "fixture",
  },
});
assert.equal(youngGunsConsensus.trustedForIdentity, true);
assert.equal(youngGunsConsensus.finalIdentity.year, "2024-25");
assert.equal(youngGunsConsensus.finalIdentity.parallel, "Base");
assert.equal(youngGunsConsensus.catalogReferee.status, "catalog_confirmed");
assert.ok(
  youngGunsConsensus.readerSummaries.every((reader) =>
    reader.evidence.some((entry) => entry.includes("No foil, color, clear stock")),
  ),
);

const glossyGold = chooseRegistryMatch(
  ai({
    player: "Alex Ovechkin",
    setName: "Upper Deck Series 1 - O-Pee-Chee Glossy",
    cardNumber: "OG-5",
    parallel: "Glossy",
    team: "Washington Capitals",
    isRookie: false,
    notes:
      "Glossy is printed on the card. A gold border and gold finish are clearly visible. No serial number is visible.",
  }),
  [
    registryCard({
      setName: "O-Pee-Chee Glossy - Gold",
      cardNumber: "OG-5",
      player: "Alex Ovechkin",
      team: "Washington Capitals",
    }),
  ],
);
assert.equal(glossyGold?.parallel, "Gold");

const dazzlersBlue = chooseRegistryMatch(
  ai({
    player: "Connor Bedard",
    setName: "2024-25 Upper Deck Series 1 - Dazzlers",
    cardNumber: "DZ-13",
    parallel: "Blue Dazzlers",
    team: "Chicago Blackhawks",
    isRookie: false,
    notes:
      "A blue bubble foil pattern is clearly visible on the Dazzlers card. No serial number is visible.",
  }),
  [
    registryCard({
      setName: "Dazzlers - Blue",
      cardNumber: "DZ-13",
      player: "Connor Bedard",
      team: "Chicago Blackhawks",
    }),
  ],
);
assert.equal(dazzlersBlue?.parallel, "Blue");

const unsafeSpeckleAsBase = chooseRegistryMatch(
  ai({
    player: "Connor Bedard",
    setName: "Upper Deck Series 1 - City Satellites",
    cardNumber: "CS-11",
    parallel: "Base",
    team: "Chicago Blackhawks",
    isRookie: false,
    notes:
      "A strong glitter and sparkle background is visible, but the exact official finish is unresolved.",
  }),
  [
    registryCard({
      setName: "City Satellites",
      cardNumber: "CS-11",
      player: "Connor Bedard",
      team: "Chicago Blackhawks",
    }),
  ],
);
assert.equal(unsafeSpeckleAsBase, null);

const unsafeAdjacentYearBase = chooseRegistryMatch(
  ai({
    player: "Connor Bedard",
    year: "2023-24",
    setName: "Upper Deck Series 1 - Gaming FOV",
    cardNumber: "GFOV-5",
    parallel: "Base",
    team: "Chicago Blackhawks",
    isRookie: false,
    notes: "No physical finish could be confirmed.",
  }),
  [
    registryCard({
      setName: "Gaming FOV",
      cardNumber: "GFOV-5",
      player: "Connor Bedard",
      team: "Chicago Blackhawks",
      season: "2024-25",
    }),
  ],
  { allowAdjacentYearRecovery: true },
);
assert.equal(unsafeAdjacentYearBase, null);

const surfaceRiskConsensus = buildInstaCompMultiScannerConsensus({
  readers: [
    buildInstaCompReaderFindingFromAi({
      readerId: "surface-primary",
      label: "Parallel surface reader",
      kind: "primary_vision",
      family: "openai",
      ai: ai({
        player: "Connor Bedard",
        setName: "Upper Deck Series 1 - City Satellites",
        cardNumber: "CS-11",
        parallel: "City Satellites",
        team: "Chicago Blackhawks",
        isRookie: false,
        notes:
          "A strong glitter and sparkle background is visible, but no exact official finish can be proven.",
      }),
    }),
  ],
  catalogReferee: catalogReferee({
    player: "Connor Bedard",
    year: "2024-25",
    brand: "Upper Deck",
    setName: "Upper Deck Series 1",
    registrySetName: "City Satellites",
    cardNumber: "CS-11",
    parallel: "Base",
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  }),
});
assert.equal(surfaceRiskConsensus.trustedForIdentity, false);
assert.equal(surfaceRiskConsensus.catalogReferee.status, "review_required");
assert.match(
  surfaceRiskConsensus.catalogReferee.matchExplanation || "",
  /unresolved visible surface\/finish evidence/i,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      confirmed: {
        youngGunsSubsetAsBase: youngGunsConsensus.trustedForIdentity,
        glossyGold: glossyGold?.parallel,
        dazzlersBlue: dazzlersBlue?.parallel,
      },
      rejected: {
        unresolvedSpeckleAsBase: unsafeSpeckleAsBase === null,
        adjacentYearBase: unsafeAdjacentYearBase === null,
        catalogBaseWithSurfaceRisk:
          surfaceRiskConsensus.catalogReferee.status === "review_required",
      },
    },
    null,
    2,
  ),
);
