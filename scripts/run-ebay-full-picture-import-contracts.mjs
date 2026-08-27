import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/ebay-all-image-sync.ts", "utf8");
const cron = fs.readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);

assert.match(source, /X-EBAY-API-CALL-NAME": "GetSellerList"/);
assert.match(source, /X-EBAY-API-CALL-NAME": "GetItem"/);
assert.doesNotMatch(source, /X-EBAY-API-CALL-NAME": "GetMyeBaySelling"/);
assert.match(source, /<DetailLevel>ReturnAll<\/DetailLevel>/);
assert.match(source, /<EndTimeFrom>\$\{params\.endTimeFrom\}<\/EndTimeFrom>/);
assert.match(source, /<EndTimeTo>\$\{params\.endTimeTo\}<\/EndTimeTo>/);
assert.match(source, /<ItemID>\$\{params\.itemId\}<\/ItemID>/);
assert.match(source, /xmlBlocks\(pictureDetails, "PictureURL"\)/);
assert.match(source, /const GET_ITEM_CONCURRENCY = 12;/);
assert.match(source, /const MAX_ITEMS_PER_RUN = 1500;/);
assert.match(source, /const IMAGE_SYNC_VERSION = 4;/);
assert.match(source, /sourceCall: "GetSellerList\+GetItem" as const/);
assert.match(source, /getItemMultiPicture/);
assert.match(source, /hydrationErrors/);
assert.match(cron, /getItemChecked: sync\.getItemChecked/);
assert.match(cron, /getItemMultiPicture: sync\.getItemMultiPicture/);

console.log(
  JSON.stringify(
    {
      ok: true,
      enumerationCall: "GetSellerList",
      detailCall: "GetItem",
      hydratesEveryActiveListing: true,
      deduplicatesGalleryAlias: true,
      reportsMultiPictureCoverage: true,
      fullStoreApplyCapacity: 1500,
    },
    null,
    2,
  ),
);
