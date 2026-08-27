import assert from "node:assert/strict";

import { applyInstaCompIdentityGuard } from "../src/lib/instacomp-identity-guard";

const baseAi = {
  player: "Sonia Citron",
  year: "2025",
  brand: "Panini",
  setName: "2025 Panini Prizm WNBA",
  cardNumber: "122",
  parallel: "Blue Cracked Ice Prizm",
  serialNumber: null,
  gradingCompany: null,
  gradeValue: null,
  certificationNumber: null,
  certificationLookupUrl: null,
  gradingEvidence: null,
  team: "Washington Mystics",
  sport: "Basketball",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: null,
  confidence: 0.93,
  notes:
    "Front surface evidence: blue | dense repeating diagonal slashes | criss-cross velocity lines. Back evidence: PRIZM.",
};

const velocity = applyInstaCompIdentityGuard(baseAi);
assert.equal(velocity.parallel, "Blue Velocity Prizm");
assert.match(
  String(velocity.notes),
  /directional velocity lines rather than irregular shattered-ice facets/i,
);

const crackedIce = applyInstaCompIdentityGuard({
  ...baseAi,
  notes:
    "Front surface evidence: blue | irregular polygonal shattered-ice facets | broken-glass geometry. Back evidence: PRIZM.",
});
assert.equal(crackedIce.parallel, "Blue Cracked Ice Prizm");

const genericBlue = applyInstaCompIdentityGuard({
  ...baseAi,
  parallel: "Blue Prizm",
  notes:
    "Front surface evidence: blue | repeating diagonal chevrons and speed-line pattern. Back evidence: PRIZM.",
});
assert.equal(genericBlue.parallel, "Blue Velocity Prizm");

console.log("InstaComp Prizm surface regressions passed.");
