import {
  transformChecklistHtml,
  transformReaderText,
} from "./mainstream-checklist/fetch-patch.mjs";

const html = [
  "<h2>Base Set Checklist</h2>",
  "<table><tr><td>1</td><td>Alpha Player</td></tr></table>",
  "<h2>Rookie Autographs Checklist</h2>",
  "<table><tr><td>1</td><td>Beta Player</td></tr></table>",
].join("");
const transformed = transformChecklistHtml(html);
const baseHeading = transformed.indexOf("## Base Set Checklist");
const baseCard = transformed.indexOf("Alpha Player");
const autographHeading = transformed.indexOf("## Rookie Autographs Checklist");
const autographCard = transformed.indexOf("Beta Player");
if (!(baseHeading < baseCard && baseCard < autographHeading && autographHeading < autographCard)) {
  throw new Error("HTML checklist headings and rows did not retain source order.");
}

const reader = transformReaderText(
  "# Product Title\n## Base Set Checklist\n1 | Alpha Player\n### Inserts Checklist\n1 | Beta Player",
);
if (!reader.includes("## Product Title") || !reader.includes("## Inserts Checklist")) {
  throw new Error("Reader fallback headings were not normalized for the parser.");
}

console.log(
  JSON.stringify({
    status: "passed",
    htmlOrderPreserved: true,
    readerHeadingsNormalized: true,
  }),
);
