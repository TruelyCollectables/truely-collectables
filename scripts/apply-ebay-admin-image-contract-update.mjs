import fs from "node:fs";

const path = "scripts/run-ebay-import-admin-client-simulations.ts";
let source = fs.readFileSync(path, "utf8");
const before = `assert.match(
  imageSync,
  /<ActiveList>[\\s\\S]*<Include>true<\\/Include>/,
  "Image synchronization must read active eBay listings only.",
);`;
const after = `assert.match(
  imageSync,
  /X-EBAY-API-CALL-NAME": "GetSellerList"/,
  "Image synchronization must enumerate the active seller listing set.",
);
assert.match(
  imageSync,
  /<EndTimeFrom>[\\s\\S]*<EndTimeTo>/,
  "Image synchronization must bound GetSellerList to the active listing end-time window.",
);
assert.match(
  imageSync,
  /X-EBAY-API-CALL-NAME": "GetItem"/,
  "Image synchronization must hydrate each active listing with its complete PictureURL set.",
);`;

if (source.includes(after)) {
  console.log("The eBay admin image contract is already current.");
  process.exit(0);
}
if (!source.includes(before)) {
  throw new Error("The stale ActiveList image contract was not found.");
}
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Updated the eBay admin image contract for GetSellerList plus GetItem.");
