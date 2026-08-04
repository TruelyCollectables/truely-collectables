import assert from "node:assert/strict";
import fs from "node:fs";

import { parseToppsFootballChecklistText } from "../src/lib/checklist-registry/topps-football-text";
import { parseToppsFootballTextChecklist } from "../src/lib/checklist-registry/topps-football-text-adapter";

const parsed = parseToppsFootballChecklistText({
  title: "2026 Topps Chrome Football Checklist",
  text: `BASE SET
1 Bo Nix Denver Broncos RC
2 Patrick Mahomes II Kansas City Chiefs

ROOKIE AUTOGRAPHS
RA-BN Bo Nix Denver Broncos Rookie
`,
});

assert.equal(parsed.releaseYear, "2026");
assert.equal(parsed.product, "Topps Chrome Football");
assert.equal(parsed.cards.length, 3);
assert.deepEqual(parsed.cards[0], {
  setName: "Base Set",
  cardNumber: "1",
  player: "Bo Nix",
  team: "Denver Broncos",
  rookie: true,
  sourceLine: 2,
});
assert.equal(parsed.cards[1].team, "Kansas City Chiefs");
assert.equal(parsed.cards[2].setName, "ROOKIE AUTOGRAPHS");
assert.equal(parsed.cards[2].rookie, true);
assert.equal(parsed.issues.some((issue) => issue.severity === "error"), false);

const plan = parseToppsFootballTextChecklist({
  sourceUrl: "https://www.topps.com/pages/2026-topps-chrome-football-checklist",
  originalFilename: "2026-Topps-Chrome-Football-Checklist.txt",
  mimeType: "text/plain",
  content: `BASE SET
1 Bo Nix Denver Broncos RC
2 Patrick Mahomes II Kansas City Chiefs
ROOKIE AUTOGRAPHS
RA-BN Bo Nix Denver Broncos Rookie
`,
  retrievedAt: "2026-08-04T00:00:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
});

assert.equal(plan.release.manufacturer, "Topps");
assert.equal(plan.release.sport, "Football");
assert.equal(plan.release.league, "NFL");
assert.equal(plan.validation.status, "passed");
assert.equal(plan.validation.counts.cards, 3);
assert.equal(plan.validation.counts.identities, 3);
assert.equal(plan.cards[0].rookieDesignation, true);
assert.equal(plan.cards[2].autographStatus, "autograph");

const collegePlan = parseToppsFootballTextChecklist({
  sourceUrl: "https://cdn.shopify.com/s/files/1/0000/files/2026-bowman-u-football.txt",
  originalFilename: "2026-Bowman-U-Football.txt",
  mimeType: "text/plain",
  content: `BASE SET
1 College Player Alabama Crimson Tide RC
`,
  retrievedAt: "2026-08-04T00:00:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
});
assert.equal(collegePlan.release.league, "NCAA");
assert.equal(collegePlan.release.sport, "Football");

const conflict = parseToppsFootballChecklistText({
  title: "2026 Topps Football Checklist",
  text: `BASE SET
1 Player One Denver Broncos
1 Player Two Kansas City Chiefs
`,
});
assert.ok(conflict.issues.some((issue) => issue.code === "topps_football_card_number_subject_conflict" && issue.severity === "error"));

const empty = parseToppsFootballChecklistText({
  title: "2026 Topps Football Checklist",
  text: "BASE SET\nChecklist subject to change",
});
assert.ok(empty.issues.some((issue) => issue.code === "topps_football_checklist_no_cards" && issue.severity === "error"));

const wrongDomain = parseToppsFootballTextChecklist({
  sourceUrl: "https://example.com/2026-topps-football.txt",
  originalFilename: "2026-Topps-Football.txt",
  mimeType: "text/plain",
  content: `BASE SET
1 Bo Nix Denver Broncos RC
`,
  retrievedAt: "2026-08-04T00:00:00.000Z",
  authority: "official_manufacturer",
  redistributionAllowed: false,
});
assert.equal(wrongDomain.validation.status, "validation_required");
assert.ok(wrongDomain.validation.issues.some((issue) => issue.code === "official_source_domain_mismatch"));

const worker = fs.readFileSync("scripts/run-topps-football-worker.ts", "utf8");
for (const marker of [
  '.eq("manufacturer", "Topps").eq("sport", "Football")',
  "Math.min(100",
  'sport: "Football"',
  'manufacturer: "Topps"',
]) {
  assert.ok(worker.includes(marker), `Missing Football isolation marker: ${marker}`);
}
assert.equal(worker.includes('.eq("sport", "Baseball")'), false);
assert.equal(worker.includes('.eq("sport", "Hockey")'), false);

console.log("Topps Football parser, adapter, and isolation regressions passed.");
