import assert from "node:assert/strict";
import { parseToppsHockeyChecklistText } from "../src/lib/checklist-registry/topps-hockey-text";
import { parseToppsHockeyTextChecklist, toppsHockeyTextChecklistAdapter } from "../src/lib/checklist-registry/topps-hockey-text-adapter";
import { getToppsSportPipeline } from "../src/lib/checklist-registry/topps-sport-pipelines";

const fixture = [
  "BASE SET",
  "1 Nathan MacKinnon Colorado Avalanche",
  "2 Connor McDavid Edmonton Oilers RC",
  "ROOKIE AUTOGRAPHS",
  "RA-1 Macklin Celebrini San Jose Sharks Rookie",
].join("\n");

const parsed = parseToppsHockeyChecklistText({
  title: "2025-26 Topps Chrome Hockey Checklist",
  text: fixture,
});
assert.equal(parsed.cards.length, 3);
assert.equal(parsed.cards[0].team, "Colorado Avalanche");
assert.equal(parsed.cards[1].rookie, true);
assert.equal(parsed.cards[2].setName, "ROOKIE AUTOGRAPHS");
assert.equal(parsed.cards[2].team, "San Jose Sharks");
assert.equal(parsed.issues.filter((issue) => issue.severity === "error").length, 0);

const artifact = {
  sourceUrl: "https://www.topps.com/2025-26-topps-chrome-hockey-checklist.pdf",
  originalFilename: "2025-26-topps-chrome-hockey-checklist.txt",
  mimeType: "text/plain",
  content: fixture,
  archiveContent: new TextEncoder().encode(fixture),
  archiveFilename: "2025-26-topps-chrome-hockey-checklist.pdf",
  archiveMimeType: "application/pdf",
  retrievedAt: "2026-08-04T00:00:00.000Z",
  authority: "official_manufacturer" as const,
  redistributionAllowed: false,
};
assert.equal(toppsHockeyTextChecklistAdapter.supports(artifact), true);
const plan = parseToppsHockeyTextChecklist(artifact);
assert.equal(plan.release.manufacturer, "Topps");
assert.equal(plan.release.sport, "Hockey");
assert.equal(plan.release.league, "NHL");
assert.equal(plan.cards.length, 3);
assert.equal(plan.identities.length, 3);
assert.equal(plan.source.storage.isPublic, false);
assert.equal(plan.validation.status, "passed");

assert.equal(toppsHockeyTextChecklistAdapter.supports({ ...artifact, sourceUrl: "https://example.com/checklist.pdf" }), false);
assert.equal(toppsHockeyTextChecklistAdapter.supports({ ...artifact, originalFilename: "2025-topps-football-checklist.txt" }), false);

const hockey = getToppsSportPipeline("hockey");
const football = getToppsSportPipeline("football");
assert.equal(hockey.sport, "Hockey");
assert.equal(hockey.maxSetsPerRun, 100);
assert.notEqual(hockey.concurrencyGroup, football.concurrencyGroup);
assert.notEqual(hockey.auditOutput, football.auditOutput);
assert.equal(hockey.includeTitle.test("2025-26 Topps Chrome NHL Hockey"), true);
assert.equal(hockey.excludeTitle.test("2025 Topps Football"), true);

console.log("Topps Hockey parser, adapter, source-trust, and sport-isolation regressions passed.");
