import fs from "node:fs";

const path = new URL(
  "../connectors/tcos-market-intel-mcp/src/public-search.mjs",
  import.meta.url,
);
let text = fs.readFileSync(path, "utf8");

const anchor = "      ebayBrowse: this.ebay.configured,\n";
const replacement = `${anchor}      ebayBrowseDetails: this.ebay.status(),\n`;
if (!text.includes("ebayBrowseDetails: this.ebay.status()")) {
  const count = text.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`Expected one eBay Browse status anchor, found ${count}.`);
  }
  text = text.replace(anchor, replacement);
}

fs.writeFileSync(path, text);
