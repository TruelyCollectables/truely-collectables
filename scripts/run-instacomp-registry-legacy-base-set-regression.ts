import assert from "node:assert/strict";
import {
  resolveInstaCompChecklistFirst,
  type InstaCompChecklistCandidate,
} from "../src/lib/instacomp-checklist-first";

// Production-shaped Sonia Citron #122 candidates. The immutable frozen-five
// answer key says the tested physical card is canonical Base, identity
// 2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f.
const candidates = [
  {
    identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    fingerprintSha256:
      "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
    year: "2025",
    manufacturer: "Panini",
    brand: "Prizm",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Base",
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  },
  {
    identityId: "afe15ced-ee4a-4e33-82df-207e698e1f93",
    fingerprintSha256:
      "2afd0b5c60208aac9ab8936710c3e7d8006eac88ada4cecb2d5670df35d4559e",
    year: "2025",
    manufacturer: "Panini",
    brand: "Prizm",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Prizms Ice",
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  },
  {
    identityId: "d1ede525-1f8b-44ac-a7ff-943678407c78",
    fingerprintSha256:
      "2a1ec61776a9a9baefad97de42c1710b1d4e23a9302ec12a3bd75aa2ed4883cb",
    year: "2025",
    manufacturer: "Panini",
    brand: "Prizm",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Prizms Orange Ice",
    variation: null,
    team: "Washington Mystics",
    sport: "Basketball",
    league: "WNBA",
  },
] satisfies InstaCompChecklistCandidate[];

const frozenBase = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Base",
    isAuto: false,
    isRelic: false,
  },
  candidates,
});

assert.equal(frozenBase.status, "exact_match");
assert.equal(frozenBase.aiRequired, false);
assert.equal(
  frozenBase.match?.identityId,
  "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
);
assert.equal(
  frozenBase.match?.fingerprintSha256,
  "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
);

const explicitIce = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Prizms Ice",
    isAuto: false,
    isRelic: false,
  },
  candidates,
});
assert.equal(explicitIce.status, "exact_match");
assert.equal(
  explicitIce.match?.identityId,
  "afe15ced-ee4a-4e33-82df-207e698e1f93",
);

const omittedParallel = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    isAuto: false,
    isRelic: false,
  },
  candidates,
});
assert.equal(omittedParallel.status, "review_required");
assert.equal(omittedParallel.match, null);
assert.equal(omittedParallel.candidates.length, 3);

const staleWrongParallel = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Orange Cracked Ice Prizm",
    isAuto: false,
    isRelic: false,
  },
  candidates,
});
assert.equal(staleWrongParallel.status, "review_required");
assert.deepEqual(staleWrongParallel.reasons, [
  "base_card_match_but_card_type_conflicts",
]);

const explicitWrongSet = resolveInstaCompChecklistFirst({
  input: {
    year: "2025",
    manufacturer: "Panini",
    brand: "Panini Prizm WNBA",
    setName: "Wrong Named Set",
    cardNumber: "122",
    player: "Sonia Citron",
    parallel: "Base",
  },
  candidates,
});
assert.equal(explicitWrongSet.status, "not_found");
assert.deepEqual(explicitWrongSet.reasons, [
  "set_name_conflicts_with_registry_candidates",
]);

console.log(
  "PASS explicit Base locks the frozen Sonia Base UUID/fingerprint, omitted parallel stays ambiguous, exact named parallels still lock, stale wrong parallels stay blocked, and named set conflicts still fail closed.",
);
