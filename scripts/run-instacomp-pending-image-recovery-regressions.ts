import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const macMain = readFileSync("services/instacomp-ai/app/main.py", "utf8");
const macImages = readFileSync("services/instacomp-ai/app/images.py", "utf8");
const macStorage = readFileSync("services/instacomp-ai/app/storage.py", "utf8");
const localClient = readFileSync("src/lib/instacomp-ai-local.ts", "utf8");
const repairRoute = readFileSync(
  "src/app/api/account/seller/instacomp-pending/repair-images/route.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260805154000_instacomp_listing_image_archive.sql",
  "utf8",
);

assert(
  macMain.includes('persist_image(front_image, image_store_path, "front")') &&
    macMain.includes('persist_image(back_image, image_store_path, "back")'),
  "Mac scan intake must preserve both normalized image files.",
);
assert(
  macMain.includes('"/v1/scans/{scan_id}/archive"') &&
    macMain.includes('"/v1/scans/{scan_id}/images/{side}"'),
  "Mac service does not expose authenticated archive recovery endpoints.",
);
assert(
  macStorage.includes("def get_scan(self, scan_id: str)"),
  "Mac archive cannot retrieve scan receipts by scan ID.",
);
assert(
  macImages.includes("def persisted_image_path") &&
    macImages.includes('side not in {"front", "back"}'),
  "Archived image lookup is not deterministic and side constrained.",
);
assert(
  localClient.includes("getInstaCompAiLocalScanArchive") &&
    localClient.includes("getInstaCompAiLocalArchivedImage"),
  "Website cannot retrieve the original Mac scan pair.",
);
assert(
  repairRoute.includes("recovered_from_mac_scan_archive") &&
    repairRoute.includes("getInstaCompAiLocalArchivedImage") &&
    repairRoute.includes('side: "front"') &&
    repairRoute.includes('side: "back"'),
  "Pending recovery does not pull both original images from the Mac archive.",
);
assert(
  repairRoute.includes('.from("products")') &&
    repairRoute.includes("legacy_product_id: productId") &&
    repairRoute.includes('.from("inventory_images")'),
  "Pending recovery does not link product and inventory-image records.",
);
assert(
  repairRoute.includes("forceIdentityRescan: true") &&
    repairRoute.includes("runVerifiedPricing"),
  "Recovered image pairs are not re-run through identity and verified pricing.",
);
assert(
  migration.includes("instacomp-listing-images") &&
    migration.includes("public") &&
    migration.includes("image/jpeg"),
  "Permanent listing-image storage contract is missing.",
);

console.log("InstaComp pending image-pair recovery regressions passed.");
