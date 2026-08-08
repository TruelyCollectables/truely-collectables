import assert from "node:assert/strict";
import {
  resolveInstaCompChecklistFirst,
  type InstaCompChecklistCandidate,
} from "../src/lib/instacomp-checklist-first";

const baseCandidate: InstaCompChecklistCandidate = {
  identityId: "ice-id",
  year: "2025",
  manufacturer: "Panini",
  brand: "Prizm",
  setName: "2025 Panini Prizm WNBA",
  cardNumber: "116",
  player: "Dominique Malonga",
  serialRun: null,
  isAuto: false,
  isRelic: false,
  parallel: "Prizms Ice",
  variation: null,
  team: "Seattle Storm",
  sport: "Basketball",
};

function decide(
  parallel: string | null,
  candidates: InstaCompChecklistCandidate[] = [baseCandidate],
) {
  return resolveInstaCompChecklistFirst({
    input: {
      year: "2025",
      manufacturer: "Panini",
      brand: "Prizm",
      setName: "2025 Panini Prizm WNBA",
      cardNumber: "116",
      player: "Dominique Malonga",
      isAuto: false,
      isRelic: false,
      parallel,
      variation: null,
    },
    candidates,
  });
}

const safeAliases = ["Prizms Ice", "Prizm Ice", "Ice Prizm"];

for (const alias of safeAliases) {
  const result = decide(alias);
  assert.equal(
    result.status,
    "exact_match",
    `${alias} should resolve to the canonical Prizms Ice identity`,
  );
  assert.equal(result.match?.identityId, "ice-id");
  console.log(`PASS ${alias} -> Prizms Ice`);
}

for (const unsafeAlias of [
  "Cracked Ice",
  "Cracked Ice Prizm",
  "White Cracked Ice Prizm",
  "Prizms Cracked Ice",
  "White Ice",
  "Blue Prizm",
  "Silver Prizm",
]) {
  const result = decide(unsafeAlias);
  assert.equal(
    result.status,
    "review_required",
    `${unsafeAlias} must not be coerced into Prizms Ice`,
  );
  assert.equal(result.match, null);
  console.log(`PASS ${unsafeAlias} remains distinct`);
}

const baseAndIce: InstaCompChecklistCandidate[] = [
  { ...baseCandidate, identityId: "base-id", parallel: "Base" },
  baseCandidate,
];
const missingParallel = decide(null, baseAndIce);
assert.equal(
  missingParallel.status,
  "review_required",
  "Missing parallel evidence must not choose between Base and Ice",
);
assert.equal(missingParallel.match, null);
console.log("PASS missing parallel stays review_required when Base and Ice both match");

console.log("InstaComp checklist parallel alias simulations passed.");
