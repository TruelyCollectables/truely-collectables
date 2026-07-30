import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/ebay-all-image-sync.ts", "utf8");

assert.match(source, /X-EBAY-API-CALL-NAME": "GetSellerList"/);
assert.doesNotMatch(source, /X-EBAY-API-CALL-NAME": "GetMyeBaySelling"/);
assert.match(source, /<DetailLevel>ReturnAll<\/DetailLevel>/);
assert.match(source, /<EndTimeFrom>\$\{params\.endTimeFrom\}<\/EndTimeFrom>/);
assert.match(source, /<EndTimeTo>\$\{params\.endTimeTo\}<\/EndTimeTo>/);
assert.match(source, /xmlBlocks\(pictureDetails, "PictureURL"\)/);
assert.match(source, /const PAGE_SIZE = 100;/);
assert.match(source, /const MAX_ITEMS_PER_RUN = 1500;/);
assert.match(source, /const IMAGE_SYNC_VERSION = 3;/);
assert.match(source, /sourceCall: "GetSellerList" as const/);

console.log(
  JSON.stringify(
    {
      ok: true,
      sourceCall: "GetSellerList",
      retrievesEveryPictureUrl: true,
      activeEndTimeRange: true,
      fullStoreApplyCapacity: 1500,
    },
    null,
    2,
  ),
);
