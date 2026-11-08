import { parseSourceBytes } from "./master-checklist-archive/archive-source-tools.mjs";

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
}

const entry = {
  minimumCardRows: 3,
  release: {
    manufacturer: "Panini",
    product: "Test Product",
    season: "2025-26",
    releaseYear: "2025",
    sport: "basketball",
  },
};

const csv = [
  "Card Number,Player,Team,Card Set,Parallel,Print Run",
  "1,Alpha Player,Denver Nuggets,Base Set,,",
  "2,Beta Player,Boston Celtics,Base Set,Silver,",
  "3,Gamma Player,Los Angeles Lakers,Autographs,Gold,10",
].join("\n");
const parsedCsv = parseSourceBytes(entry, {
  bytes: Buffer.from(csv, "utf8"),
  mimeType: "text/csv",
  filename: "checklist.csv",
});
assert(parsedCsv.parsed.errors.length === 0, "Structured CSV produced parser errors", parsedCsv.parsed.errors);
assert(parsedCsv.parsed.cards.length === 3, "Structured CSV row count mismatch", parsedCsv.parsed.cards);
assert(parsedCsv.parsed.cards[0].players[0] === "Alpha Player", "Player column was contaminated", parsedCsv.parsed.cards[0]);
assert(parsedCsv.parsed.cards[0].teams[0] === "Denver Nuggets", "Team column was lost", parsedCsv.parsed.cards[0]);
assert(parsedCsv.parsed.cards[1].setName.includes("Silver"), "Parallel distinction was lost", parsedCsv.parsed.cards[1]);

const tsv = [
  "row_id\tplayer\tcard_number\tcard_set\tprint_run\tteam",
  "1\tAlpha Player\tAA-1\tAutograph Alley Red\t10\tTeam A",
  "2\tBeta Player\tAA-2\tAutograph Alley Blue\t25\tTeam B",
  "3\tGamma Player\tAA-3\tAutograph Alley Gold\t1\tTeam C",
].join("\n");
const parsedTsv = parseSourceBytes(entry, {
  bytes: Buffer.from(tsv, "utf8"),
  mimeType: "text/tab-separated-values",
  filename: "checklist.tsv",
});
assert(parsedTsv.parsed.cards.length === 3, "TSV header mapping failed", parsedTsv.parsed.cards);
assert(parsedTsv.parsed.cards[0].cardNumber === "AA-1", "row_id was incorrectly used as card number", parsedTsv.parsed.cards[0]);
assert(parsedTsv.parsed.cards[0].players[0] === "Alpha Player", "TSV player mapping failed", parsedTsv.parsed.cards[0]);

console.log(JSON.stringify({ status: "passed", structuredCsv: true, structuredTsv: true, rowIdIgnored: true }));
