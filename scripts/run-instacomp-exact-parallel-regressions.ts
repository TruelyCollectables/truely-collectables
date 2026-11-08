import assert from "node:assert/strict";
import {
  explainInstaCompParallelMismatch,
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
  scoreCompMatch,
  type InstaCompAiResult,
  type InstaCompComp,
} from "../src/lib/instacomp";

const target: InstaCompAiResult = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Select Rookie Swatches",
  cardNumber: "RSW-SSS",
  parallel: "Red Prizm",
  serialNumber: null,
  team: "Browns",
  sport: "Football",
  isRookie: true,
  isAuto: false,
  isRelic: true,
  conditionGuess: "Near Mint",
  confidence: 1,
  notes: null,
};

const comp = (title: string): Omit<InstaCompComp, "matchScore" | "flags"> => ({
  title,
  price: 10,
  currency: "USD",
  url: `https://example.com/${encodeURIComponent(title)}`,
  imageUrl: null,
  source: "ebay_active",
  sourceLabel: "eBay Active",
  sourceCategory: "marketplace",
});

const red = comp(
  "2025 Panini Select Shedeur Sanders Rookie Swatches Relic Red Prizm #RSW-SSS",
);
const blue = comp(
  "2025 Panini Select Shedeur Sanders Rookie Swatches Relic Blue Prizm #RSW-SSS",
);
const redWhiteBlue = comp(
  "2025 Panini Select Shedeur Sanders Rookie Swatches Relic Red White Blue Prizm #RSW-SSS",
);

assert.equal(filterAndRankExactMatches([red], target, 5, 0).length, 1);
assert.equal(filterAndRankExactMatches([blue], target, 5, 0).length, 0);
assert.equal(filterAndRankExactMatches([redWhiteBlue], target, 5, 0).length, 0);
assert.match(
  explainInstaCompParallelMismatch(blue.title, target.parallel) || "",
  /expected Red Prizm; listing says blue/i,
);
assert.match(
  explainInstaCompParallelMismatch(redWhiteBlue.title, target.parallel) || "",
  /expected Red Prizm; listing says (blue\/white|white\/blue)/i,
);
assert.ok(scoreCompMatch(red.title, target).score > scoreCompMatch(blue.title, target).score);
const guidance = filterAndRankGuidanceMatches([blue], target, 5, -1000);
assert.equal(guidance.length, 1);
assert.ok(
  guidance[0].flags.some((flag) =>
    /parallel mismatch: expected Red Prizm; listing says blue/i.test(flag),
  ),
);
assert.ok(guidance[0].flags.includes("not exact parallel"));

console.log(
  "InstaComp exact-parallel regression passed: Blue and Red/White/Blue Prizms are rejected for a Red Prizm target and cannot appear as exact competition.",
);
