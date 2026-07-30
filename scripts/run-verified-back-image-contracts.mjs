import assert from "node:assert/strict";
import fs from "node:fs";
import {
  companionBackListingImageUrl,
  listingImageSide,
  selectFrontBackListingImages,
} from "../src/lib/listing-image-utils.ts";

const ebayFront =
  "https://i.ebayimg.com/images/g/front-identity/s-l1600.jpg";
const ebayBack =
  "https://i.ebayimg.com/images/g/back-identity/s-l1600.jpg";
const collxFront =
  "https://storage.googleapis.com/cdp-batches-prod/1/123-front.jpg";
const collxBack =
  "https://storage.googleapis.com/cdp-batches-prod/1/123-back.jpg";

assert.equal(listingImageSide(collxFront), "front");
assert.equal(listingImageSide(collxBack), "back");
assert.equal(listingImageSide(ebayFront), null);
assert.equal(companionBackListingImageUrl(collxFront), collxBack);
assert.deepEqual(selectFrontBackListingImages([ebayFront, collxFront]), [
  ebayFront,
]);
assert.deepEqual(
  selectFrontBackListingImages([ebayFront, collxFront, collxBack]),
  [ebayFront, collxBack],
);
assert.deepEqual(selectFrontBackListingImages([ebayFront, ebayBack]), [
  ebayFront,
  ebayBack,
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
      acceptsVerifiedCompanionBack: true,
      acceptsSecondEbayImage: true,
      scheduledReconciliation: true,
    },
    null,
    2,
  ),
);
