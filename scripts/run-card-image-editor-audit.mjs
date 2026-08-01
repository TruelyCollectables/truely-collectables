import fs from "node:fs";

const admin = fs.readFileSync("src/app/admin/page.tsx", "utf8");
const gateway = fs.readFileSync(
  "src/app/admin/pending-card-import/TcosListingGateway.tsx",
  "utf8",
);
const api = fs.readFileSync(
  "src/app/api/admin/card-listing-images/route.ts",
  "utf8",
);

const checks = [
  [
    "admin command center links directly to Card Intake & Listing",
    admin.includes('/admin/pending-card-import') &&
      admin.includes('label="Card Intake & Listing"'),
  ],
  [
    "gateway exposes left and right rotation for each image",
    gateway.includes("Rotate left") && gateway.includes("Rotate right"),
  ],
  [
    "gateway exposes front/back swap",
    gateway.includes("Swap front ↔ back") && gateway.includes('action: "swap"'),
  ],
  [
    "gateway refreshes image URLs and resets stale InstaComp values",
    gateway.includes('const frontImageUrl = String(data.frontImageUrl || "")') &&
      gateway.includes("frontImageUrl,") &&
      gateway.includes('instaCompStatus: "pending"'),
  ],
  [
    "image API uses Sharp for durable rotation",
    api.includes('from "sharp"') && api.includes(".rotate(params.degrees"),
  ],
  [
    "image API is admin-only",
    api.includes("requireAdmin(request)") &&
      api.includes("Card image editing is owner/admin only"),
  ],
  [
    "image API blocks edits to active or marketplace-linked inventory",
    api.includes("BLOCKED_CHANNEL_STATUSES") &&
      api.includes('card.inventory.status !== "draft"') &&
      api.includes("card.product?.ebay_item_id"),
  ],
  [
    "image API updates product primary image and inventory image order",
    api.includes('.from("products")') &&
      api.includes("image_url: front") &&
      api.includes('.from("inventory_images")') &&
      api.includes("is_primary: true") &&
      api.includes("sort_order: 0"),
  ],
  [
    "image API persists front/back URLs and invalidates InstaComp",
    api.includes("frontImageUrl: params.front") &&
      api.includes("backImageUrl: params.back") &&
      api.includes('status: "pending"') &&
      api.includes("invalidatedByImageEdit: true"),
  ],
  [
    "image API records an edit history",
    api.includes("imageEditing") && api.includes("history:"),
  ],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`Card image editor audit failed ${failed}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Card image editor audit passed ${checks.length}/${checks.length} checks.`);
