import assert from "node:assert/strict";
import { chooseRegistryMatch } from "../src/lib/instacomp-learning-server";

function identity(id: string, parallel: string, serialRun: number) {
  return {
    id,
    fingerprint_sha256: `fingerprint-${id}`,
    parallel: { name: parallel, serial_run: serialRun },
    variation: null,
    autograph_status: "none",
    memorabilia_status: "none",
    metadata: {},
    canonical_key: "",
  };
}

const rows = [
  {
    card_number: "SS-1",
    variation: null,
    players: [{ player: { canonical_name: "Shedeur Sanders" } }],
    teams: [{ team: { canonical_name: "Cleveland Browns" } }],
    release: {
      release_year: "2025",
      season: "2025",
      manufacturer: { name: "Panini" },
      brand: { name: "Origins" },
      product_name: "Panini Origins Football",
      sport: { name: "Football" },
      league: { name: "NFL" },
    },
    set: { name: "Rookies" },
    autograph_status: "none",
    memorabilia_status: "none",
    identities: [
      identity("red-199", "Red", 199),
      identity("blue-199", "Blue", 199),
    ],
  },
];

const baseEvidence = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Origins Football Rookies",
  cardNumber: "SS-1",
  serialNumber: "071/199",
  team: "Cleveland Browns",
  sport: "Football",
  league: "NFL",
  isAuto: false,
  isRelic: false,
};

const blue = chooseRegistryMatch({ ...baseEvidence, parallel: "Blue" }, rows);
assert.equal(blue?.identityId, "blue-199");
assert.equal(blue?.parallel, "Blue");

const red = chooseRegistryMatch({ ...baseEvidence, parallel: "Red" }, rows);
assert.equal(red?.identityId, "red-199");

const contradictory = chooseRegistryMatch(
  { ...baseEvidence, parallel: "Purple" },
  rows,
);
assert.equal(
  contradictory,
  null,
  "An unsupported visible color must not resolve only because /199 matches.",
);

const missingVisualParallel = chooseRegistryMatch(
  { ...baseEvidence, parallel: null },
  rows,
);
assert.equal(
  missingVisualParallel,
  null,
  "A numbered checklist identity requires visible parallel evidence.",
);

console.log("InstaComp serial + visible color gate regressions passed (4 assertions).");
