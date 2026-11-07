import assert from "node:assert/strict";

import { parseToppsBaseballChecklistText } from "../src/lib/checklist-registry/topps-baseball-text";

const parsed = parseToppsBaseballChecklistText({
  title: "2025 Topps Chrome Baseball Checklist",
  text: `
2025 Topps Chrome Baseball Checklist
BASE
BASE CARDS
1 Shohei Ohtani Los Angeles Dodgers®
2 J.T. Realmuto Philadelphia Phillies®
3 Brooks Baldwin Chicago White Sox® Rookie
4 Jose Altuve Houston Astros®
50 Mookie Betts Los Angeles Dodgers®51 Miguel Vargas Chicago White Sox®
FUTURE STARS
FS-1 Jackson Chourio Milwaukee Brewers™
`,
});

assert.equal(parsed.releaseYear, "2025");
assert.equal(parsed.product, "Topps Chrome Baseball");
assert.equal(parsed.cards.length, 7);
assert.deepEqual(parsed.cards[0], {
  setName: "Base Set",
  cardNumber: "1",
  player: "Shohei Ohtani",
  team: "Los Angeles Dodgers",
  rookie: false,
  sourceLine: 5,
});
assert.deepEqual(parsed.cards[3], {
  setName: "Base Set",
  cardNumber: "4",
  player: "Jose Altuve",
  team: "Houston Astros",
  rookie: false,
  sourceLine: 8,
});
assert.equal(parsed.cards[2].rookie, true);
assert.equal(parsed.cards[4].cardNumber, "50");
assert.equal(parsed.cards[5].cardNumber, "51");
assert.equal(parsed.cards[6].setName, "FUTURE STARS");
assert.equal(parsed.cards[6].cardNumber, "FS-1");
assert.equal(parsed.issues.filter((issue) => issue.severity === "error").length, 0);

const conflict = parseToppsBaseballChecklistText({
  title: "2025 Topps Test Baseball Checklist",
  text: `
BASE CARDS
1 Player One New York Yankees®
1 Player Two Boston Red Sox®
`,
});
assert.equal(
  conflict.issues.some((issue) => issue.code === "topps_card_number_subject_conflict"),
  true,
);

const empty = parseToppsBaseballChecklistText({
  title: "2025 Topps Empty Baseball Checklist",
  text: "BASE CARDS",
});
assert.equal(
  empty.issues.some((issue) => issue.code === "topps_checklist_no_cards"),
  true,
);

console.log("Topps baseball text parser regressions passed.");
