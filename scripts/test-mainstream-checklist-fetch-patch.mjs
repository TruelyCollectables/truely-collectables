import {
  transformChecklistHtml,
  transformReaderText,
} from "./mainstream-checklist/fetch-patch.mjs";
import {
  transformSemanticChecklistHtml,
  transformReaderSemanticText,
} from "./mainstream-checklist/html-semantic-prepatch.mjs";
import {
  extractReaderCardRows,
  extractTotalCards,
} from "./mainstream-checklist/tcdb-reader-complete.mjs";
import {
  rewriteHtmlHeadingHierarchy,
} from "./mainstream-checklist/section-hierarchy-prepatch.mjs";

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

const readerBullets = transformReaderSemanticText(
  "## Base Set Checklist\n* 1 Alpha Player\n- 2 Beta Player\n* Rookie Autographs Checklist\n+ RA-1 Gamma Player",
);
if (
  !readerBullets.includes("1 Alpha Player") ||
  !readerBullets.includes("2 Beta Player") ||
  !readerBullets.includes("Rookie Autographs Checklist") ||
  !readerBullets.includes("RA-1 Gamma Player") ||
  readerBullets.includes("* 1 Alpha Player")
) {
  throw new Error("Reader checklist bullets were not normalized into parser-ready rows.");
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

const deepHierarchy = rewriteHtmlHeadingHierarchy([
  "<h1>2008 Topps Heritage</h1>",
  "<h2>Checklist</h2>",
  "<h3>Base Set</h3>",
  "<h4>Heritage Series</h4>",
  "<h2>Parallels</h2>",
  "<h3>Chrome</h3>",
  "<h4>Heritage Series</h4>",
  "<h2>Inserts</h2>",
  "<h3>Then & Now</h3>",
  "<h4>Heritage Series</h4>",
].join(""));
for (const expected of [
  "Base Set - Heritage Series",
  "Parallels - Chrome - Heritage Series",
  "Inserts - Then & Now - Heritage Series",
]) {
  if (!deepHierarchy.includes(expected)) {
    throw new Error(`Checklist hierarchy did not preserve context: ${expected}`);
  }
}

const tcdbReader = [
  "Title: 2001 Fleer Genuine Football Checklist",
  "**Total Cards:** 155",
  "[](https://www.tcdb.com/Checklist.cfm/sid/4466/2001-Fleer-Genuine)[![Image 3: Image thumbnail](https://www.tcdb.com/Images/Thumbs/Football/4466/4466_983398Thumb.jpg)](https://www.tcdb.com/ViewCard.cfm/sid/4466/cid/983398/2001-Fleer-Genuine-1-Donovan-McNabb?PageIndex=1)[1](https://www.tcdb.com/ViewCard.cfm/sid/4466/cid/983398/2001-Fleer-Genuine-1-Donovan-McNabb?PageIndex=1)[Donovan McNabb](https://www.tcdb.com/Person.cfm/pid/11613/Donovan-McNabb)[Philadelphia Eagles](https://www.tcdb.com/Team.cfm/tid/202/Philadelphia-Eagles)",
  "[](https://www.tcdb.com/Checklist.cfm/sid/4466/2001-Fleer-Genuine)[2](https://www.tcdb.com/ViewCard.cfm/sid/4466/cid/983399/2001-Fleer-Genuine-2-Daunte-Culpepper?PageIndex=1)[Daunte Culpepper](https://www.tcdb.com/Person.cfm/pid/9490/Daunte-Culpepper)[Minnesota Vikings](https://www.tcdb.com/Team.cfm/tid/196/Minnesota-Vikings)",
].join("\n");
if (extractTotalCards(tcdbReader) !== 155) {
  throw new Error("TCDB reader Total Cards value was not decoded.");
}
const tcdbRows = extractReaderCardRows(tcdbReader);
if (
  tcdbRows.length !== 2 ||
  tcdbRows[0].cardNumber !== "1" ||
  tcdbRows[0].subject !== "Donovan McNabb" ||
  tcdbRows[0].team !== "Philadelphia Eagles"
) {
  throw new Error(`TCDB reader card rows were not decoded: ${JSON.stringify(tcdbRows)}`);
}

console.log(
  JSON.stringify({
    status: "passed",
    htmlOrderPreserved: true,
    oneCellSectionsPromoted: true,
    strongSectionsPromoted: true,
    readerHeadingsNormalized: true,
    readerChecklistBulletsNormalized: true,
    nestedChecklistHierarchyPreserved: true,
    deepChecklistHierarchyPreserved: true,
    numericProductProseGuarded: true,
    tcdbReaderRowsDecoded: true,
  }),
);
