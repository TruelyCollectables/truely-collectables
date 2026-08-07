import {
  transformChecklistHtml,
  transformReaderText,
} from "./mainstream-checklist/fetch-patch.mjs";
import { transformSemanticChecklistHtml } from "./mainstream-checklist/html-semantic-prepatch.mjs";

const html = [
  "<h2>Base Set Checklist</h2>",
  "<table><tr><td>1</td><td>Alpha Player</td></tr>",
  "<tr><td>Rookie Ticket Autographs Checklist</td></tr>",
  "<tr><td>1</td><td>Beta Player</td></tr></table>",
  "<p><strong>Veteran Ticket Autographs</strong></p>",
  "<table><tr><td>1</td><td>Gamma Player</td></tr></table>",
].join("");
const transformed = transformChecklistHtml(html);
const baseHeading = transformed.indexOf("## Base Set Checklist");
const baseCard = transformed.indexOf("Alpha Player");
const rookieHeading = transformed.indexOf("## Rookie Ticket Autographs Checklist");
const rookieCard = transformed.indexOf("Beta Player");
const veteranHeading = transformed.indexOf("## Veteran Ticket Autographs");
const veteranCard = transformed.indexOf("Gamma Player");
if (!(
  baseHeading < baseCard &&
  baseCard < rookieHeading &&
  rookieHeading < rookieCard &&
  rookieCard < veteranHeading &&
  veteranHeading < veteranCard
)) {
  throw new Error("HTML checklist section labels and rows did not retain source order.");
}

const reader = transformReaderText(
  "# Product Title\n## Base Set Checklist\n1 | Alpha Player\nRookie Autographs Checklist\n1 | Beta Player",
);
if (
  !reader.includes("## Product Title") ||
  !reader.includes("## Base Set Checklist") ||
  !reader.includes("## Rookie Autographs Checklist")
) {
  throw new Error("Reader fallback headings were not normalized for the parser.");
}

const semantic = transformSemanticChecklistHtml([
  "<h2>Base Set</h2>",
  "<h3>Series One</h3>",
  "<p>1 Alpha Player</p>",
  "<h2>Legends Variations</h2>",
  "<h3>Series One</h3>",
  "<p>1 Legend Player</p>",
  "<p>407 cards. The last 7 cards are short prints.</p>",
].join(""));
if (!semantic.includes("Base Set - Series One")) {
  throw new Error("Base nested checklist heading was flattened.");
}
if (!semantic.includes("Legends Variations - Series One")) {
  throw new Error("Variation nested checklist heading was flattened.");
}
if (!semantic.includes("NOTE: 407 cards.")) {
  throw new Error("Numeric product prose was not guarded from card parsing.");
}

console.log(
  JSON.stringify({
    status: "passed",
    htmlOrderPreserved: true,
    oneCellSectionsPromoted: true,
    strongSectionsPromoted: true,
    readerHeadingsNormalized: true,
    nestedChecklistHierarchyPreserved: true,
    numericProductProseGuarded: true,
  }),
);
