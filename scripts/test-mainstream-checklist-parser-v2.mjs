import { parseChecklist } from "./mainstream-checklist/source-tools.mjs";

function assert(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
  }
}

const scoped = parseChecklist(
  { minimumCardRows: 3 },
  [
    "## Description",
    "1 | 150",
    "## Insertion Ratios",
    "Changing Faces Red | 300 | 150 | 1:9",
    "1 | 99",
    "## Checklist",
    "## Base Set",
    "1 | Alpha Player RC | Colorado Rockies",
    "2 | Beta Player | Boston Red Sox",
    "3 | Gamma Player | Seattle Mariners",
    "## Important Links",
    "1 | 200",
  ].join("\n"),
);
assert(scoped.errors.length === 0, "Metadata scope produced parser errors", scoped.errors);
assert(scoped.cards.length === 3, "Metadata/odds rows leaked into checklist", scoped.cards);
assert(scoped.cards[0].rookieDesignation === true, "Rookie designation was lost");

const nested = parseChecklist(
  { minimumCardRows: 4 },
  [
    "## Checklist",
    "## Base Set",
    "## Series One",
    "1 | Alpha Player",
    "2 | Beta Player",
    "## Autographs",
    "## Series One",
    "1 | Gamma Player",
    "2 | Delta Player",
  ].join("\n"),
);
assert(nested.errors.length === 0, "Nested sections produced conflicts", nested.errors);
const names = new Set(nested.cards.map((card) => card.setName));
assert(names.has("Base Set - Series One"), "Base Series One section was flattened", [...names]);
assert(names.has("Autographs - Series One"), "Autograph Series One section was flattened", [...names]);

const duplicateMaster = parseChecklist(
  { minimumCardRows: 2 },
  [
    "## Checklist",
    "## Base Set",
    "1 | Alpha Player",
    "2 | Beta Player",
    "## Master Checklist",
    "1 | Wrong Duplicate Subject",
    "2 | Wrong Duplicate Subject Two",
  ].join("\n"),
);
assert(duplicateMaster.errors.length === 0, "Repeated master list created false conflicts", duplicateMaster.errors);
assert(duplicateMaster.cards.length === 2, "Repeated master list was imported twice", duplicateMaster.cards);

console.log(JSON.stringify({
  status: "passed",
  metadataRowsIgnored: true,
  nestedSectionsPreserved: true,
  repeatedMasterListIgnored: true,
}));
