import assert from "node:assert/strict";
import fs from "node:fs";
import {
  companionBackListingImageUrl,
  listingImageIdentity,
  listingImageSide,
  selectFrontBackListingImages,
} from "../src/lib/listing-image-utils.ts";

const ebayFront =
  "https://i.ebayimg.com/images/g/front-identity/s-l1600.jpg";
const ebayGalleryAlias =
  "https://i.ebayimg.com/00/s/NDgwWDY0MA==/z/front-identity/$_1.JPG?set_id=8800005007";
const ebayBack =
  "https://i.ebayimg.com/images/g/back-identity/s-l1600.jpg";
const collxFront =
  "https://storage.googleapis.com/cdp-batches-prod/1/123-front.jpg";
const collxBack =
  "https://storage.googleapis.com/cdp-batches-prod/1/123-back.jpg";
const collxExportFront =
  "https://storage.googleapis.com/collx-product-images/1129514363171081216-1-ZVwy.jpg";
const collxExportBack =
  "https://storage.googleapis.com/collx-product-images/1129514363171081216-2-aFH5.jpg";

assert.equal(listingImageSide(collxFront), "front");
assert.equal(listingImageSide(collxBack), "back");
assert.equal(listingImageSide(collxExportFront), "front");
assert.equal(listingImageSide(collxExportBack), "back");
assert.equal(listingImageSide(ebayFront), null);
assert.equal(companionBackListingImageUrl(collxFront), collxBack);
assert.equal(companionBackListingImageUrl(collxExportFront), "");
assert.equal(
  listingImageIdentity(ebayGalleryAlias),
  listingImageIdentity(ebayFront),
);
assert.deepEqual(
  selectFrontBackListingImages([ebayFront, ebayGalleryAlias]),
  [ebayFront],
);
assert.deepEqual(
  selectFrontBackListingImages([ebayFront, ebayGalleryAlias, ebayBack]),
  [ebayFront, ebayBack],
);
assert.deepEqual(selectFrontBackListingImages([ebayFront, collxFront]), [
  ebayFront,
]);
assert.deepEqual(
  selectFrontBackListingImages([ebayFront, collxFront, collxBack]),
  [collxFront, collxBack],
);
assert.deepEqual(
  selectFrontBackListingImages([
    ebayFront,
    ebayBack,
    collxExportFront,
    collxExportBack,
  ]),
  [collxExportFront, collxExportBack],
);
assert.deepEqual(selectFrontBackListingImages([ebayFront, ebayBack]), [
  ebayFront,
  ebayBack,
]);
assert.deepEqual(selectFrontBackListingImages([ebayFront, collxBack]), [
  ebayFront,
  collxBack,
]);

const gallery = fs.readFileSync(
  "src/app/components/ProductImageGallery.tsx",
  "utf8",
);
const sync = fs.readFileSync(
  "src/lib/companion-back-image-sync.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/cron/companion-back-image-sync/route.ts",
  "utf8",
);
const vercel = fs.readFileSync("vercel.json", "utf8");

assert.match(gallery, /Back photo unavailable/);
assert.match(gallery, /selectFrontBackListingImages/);
assert.match(sync, /verifyRemoteImage/);
assert.match(sync, /contentType\.toLowerCase\(\)\.startsWith\("image\/"\)/);
assert.match(sync, /companionBackListingImageUrl/);
assert.match(route, /timingSafeEqual/);
assert.match(route, /limit: 250/);
assert.match(vercel, /\/api\/cron\/companion-back-image-sync/);

console.log(
  JSON.stringify(
    {
      ok: true,
      rejectsMislabeledFrontAsBack: true,
      deduplicatesEbayGalleryAlias: true,
      preservesCompleteVerifiedPair: true,
      recognizesCollxExportPair: true,
      prefersExplicitCollxPairOverEbayPair: true,
      acceptsVerifiedCompanionBack: true,
      acceptsSecondEbayImage: true,
      scheduledReconciliation: true,
    },
    null,
    2,
  ),
);
