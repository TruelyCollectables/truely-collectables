import {
  declaredCardFloor,
  observedCardLines,
  shouldPreferReader,
} from "./mainstream-checklist/prefer-complete-reader.mjs";
import {
  isReaderRequest,
} from "./mainstream-checklist/reader-retry-prepatch.mjs";

function assert(condition, message, detail = null) {
  if (!condition) throw new Error(`${message}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
}

const complete = [
  "## Bowman Base",
  "200 cards.",
  ...Array.from({ length: 200 }, (_, index) => `BD-${index + 1} Player ${index + 1}, Team`),
].join("\n");
assert(declaredCardFloor(complete) === 200, "Declared 200-card floor was not detected");
assert(observedCardLines(complete) === 200, "Complete reader card rows were not counted");

const truncated = [
  "## Bowman Base",
  "200 cards.",
  "BD-1 Player One, Team",
  "BD-2 Player Two, Team",
  "BD-3 Player Three, Team",
  "BD-4 Player Four, Team",
  "BD-5 Player Five, Team",
].join("\n");
assert(declaredCardFloor(truncated) === 200, "Truncated source lost its declared floor");
assert(observedCardLines(truncated) === 5, "Truncated source row count was not detected");
assert(
  observedCardLines(truncated) < declaredCardFloor(truncated),
  "Truncated editorial source would not be rejected",
);

const metadata = [
  "Cards per pack: 5",
  "Packs per box: 12",
  "Set size: 100 cards.",
  ...Array.from({ length: 100 }, (_, index) => `${index + 1} Player ${index + 1}`),
].join("\n");
assert(declaredCardFloor(metadata) === 100, "Set-size floor was not detected");
assert(observedCardLines(metadata) === 100, "Metadata rows leaked into card-line count");

assert(
  shouldPreferReader("https://www.beckett.com/news/2024-bowman-draft-baseball-cards/"),
  "Beckett News should prefer the complete reader representation",
);
assert(
  shouldPreferReader("https://www.cardboardconnection.com/2016-topps-heritage-baseball-cards"),
  "Cardboard Connection should prefer the complete reader representation",
);
assert(
  !shouldPreferReader("https://www.tcdb.com/Checklist.cfm/sid/4466/2001-Fleer-Genuine"),
  "TCDB should remain on its count-reconciled reader module",
);
assert(isReaderRequest("https://r.jina.ai/https://www.tcdb.com/Checklist.cfm/sid/4466/2001-Fleer-Genuine"), "Reader retry wrapper did not recognize r.jina.ai");

console.log(JSON.stringify({
  status: "passed",
  declaredFloorEnforced: true,
  truncatedEditorialSourcesRejected: true,
  metadataIgnored: true,
  readerHostsRecognized: true,
}));
