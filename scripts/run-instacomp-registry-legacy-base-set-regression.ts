import assert from "node:assert/strict";
import {
  resolveInstaCompChecklistFirst,
  type InstaCompChecklistCandidate,
} from "../src/lib/instacomp-checklist-first";

const candidates = [
  {
    identityId: "sonia-122-orange-cracked-ice",
    fingerprintSha256: "a".repeat(64),
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Panini Prizm WNBA",
    setName: "2025 Panini Prizm WNBA",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Orange Cracked Ice Prizm",
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  },
  {
    identityId: "sonia-122-silver",
    fingerprintSha256: "b".repeat(64),
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini",
    product: "Panini Prizm WNBA",
    setName: "2025 Panini Prizm WNBA",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Silver Prizm",
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  },
] satisfies InstaCompChecklistCandidate[];

const legacyTrustedMemory = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Orange Cracked Ice Prizm",
  },
  candidates,
});

assert.equal(legacyTrustedMemory.status, "exact_match");
assert.equal(legacyTrustedMemory.aiRequired, false);
assert.equal(
  legacyTrustedMemory.match?.identityId,
  "sonia-122-orange-cracked-ice",
);
assert.deepEqual(legacyTrustedMemory.reasons, ["checklist_exact_match"]);

const explicitWrongSet = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Wrong Named Set",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Orange Cracked Ice Prizm",
  },
  candidates,
});

assert.equal(explicitWrongSet.status, "not_found");
assert.deepEqual(explicitWrongSet.reasons, [
  "set_name_conflicts_with_registry_candidates",
]);

const ambiguousWithoutParallel = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
  },
  candidates,
});

assert.equal(ambiguousWithoutParallel.status, "review_required");
assert.equal(ambiguousWithoutParallel.match, null);
assert.equal(ambiguousWithoutParallel.candidates.length, 2);

console.log(
  "PASS legacy set_name=Base is ignored as non-set evidence, exact named parallels still lock, named set conflicts still fail closed, and unresolved variants still require review.",
);
