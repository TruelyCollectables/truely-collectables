import assert from "node:assert/strict";
import { classifyMasterSportCandidate } from "./master-checklist-sport-classifier.mjs";

function classify({ title, url, product = "Test Product", files = [], text = "" }) {
  return classifyMasterSportCandidate(
    { title, sourceUrl: url, files },
    { product },
    text,
  );
}

assert.equal(
  classify({
    title: "2025 Topps Universe WWE Checklist",
    url: "https://www.bigapplecollects.com/soccer/checklists/2025-topps-universe-wwe-checklist",
    text: "Cavan Sullivan Philadelphia Union Lionel Messi MLS",
  }).sport,
  "soccer",
  "Strong /soccer/ path must beat a stale WWE-looking title when the source page is a soccer checklist.",
);

assert.equal(
  classify({
    title: "2026 Topps Chrome Bowman Basketball Checklist",
    url: "https://www.bigapplecollects.com/nba/checklists/2026-topps-chrome-wwe-checklist",
    text: "Cooper Flagg Dallas Mavericks Dylan Harper San Antonio Spurs",
  }).sport,
  "basketball",
  "Strong /nba/ path must beat a stale WWE-looking slug.",
);

assert.equal(
  classify({
    title: "2023-24 Panini Prizm WWE Checklist",
    url: "https://www.bigapplecollects.com/non-sports/checklists/2023-panini-prizm-ufc-checklist",
    text: "Liv Morgan SmackDown Braun Strowman Raw",
  }).sport,
  "wrestling",
  "Generic /non-sports/ path must not override explicit WWE title/body evidence.",
);

assert.equal(
  classify({
    title: "2025-26 Panini Prizm Golf Checklist",
    url: "https://www.bigapplecollects.com/non-sports/checklists/2025-panini-prizm-wrestling-checklist",
    text: "Jon Rahm Legion XIII Brooks Koepka Smash GC",
  }).sport,
  "golf",
  "Generic /non-sports/ path must not override explicit golf evidence.",
);

assert.equal(
  classify({
    title: "Panini America Releases 2014-15 NBA, NFL & NHL Sticker Collection Checklists",
    url: "https://gogts.net/panini-america-releases-2014-15-nba-nfl-nhl-sticker-collection-checklists/",
    text: "NFL 2014 Sticker Checklist NBA 2014-15 Sticker Checklist NHL 2014-15 Stickers Checklist",
  }).sport,
  "aggregate_multi_release",
  "An article explicitly spanning NBA, NFL and NHL must never become one sport release.",
);

assert.equal(
  classify({
    title: "2026 Leaf Metal Sports Heroes Trading Cards Checklist",
    url: "https://gogts.net/2026-leaf-metal-sports-heroes-trading-cards-checklist/",
    text: "Multi/Other Sport Checklists Peyton Manning Barry Sanders Conor McGregor Giannis Antetokounmpo",
  }).sport,
  "multi-sport",
  "Archived source category must retain a true multisport product.",
);

assert.equal(
  classify({
    title: "2025 Leaf Electrum Multisport",
    url: "https://www.breakninja.com/multisport/2025-Leaf-Electrum-Multiple-Sport-Checklist.php?page_no=1",
  }).sport,
  "multi-sport",
);

assert.equal(
  classify({
    title: "2025 Star Wars Chrome Checklist",
    url: "https://www.bigapplecollects.com/non-sports/checklists/2025-star-wars-chrome-checklist",
  }).sport,
  "excluded_non_sport",
  "Entertainment-only source must remain outside the sports Registry.",
);

assert.equal(
  classify({
    title: "Mystery Collection Checklist",
    url: "https://example.invalid/checklists/mystery",
  }).sport,
  "needs_sport_review",
  "Unproven sport classification must fail closed.",
);

console.log(JSON.stringify({
  status: "passed",
  strongSportPathsWinOverStaleSlugs: true,
  nonSportsPathDoesNotOverrideSportEvidence: true,
  aggregateArticleRejectedAsRelease: true,
  trueMultisportPreserved: true,
  entertainmentExcluded: true,
  unresolvedFailsClosed: true,
}));
