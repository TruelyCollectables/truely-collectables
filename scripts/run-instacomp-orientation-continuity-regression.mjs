import assert from "node:assert/strict";
import fs from "node:fs";

const exact = fs.readFileSync(
  "src/app/api/kingmaker/instacomp-front-back-exact/route.ts",
  "utf8",
);
const accept = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/accept-verification/route.ts",
  "utf8",
);
const auto = fs.readFileSync(
  "src/app/api/kingmaker/instacomp-front-back-auto/route.ts",
  "utf8",
);
const storage = fs.readFileSync(
  "src/lib/instacomp-normalized-image-storage.ts",
  "utf8",
);

assert.ok(
  exact.includes("stablePairRegistryCandidate && storedPairOrientation"),
  "Exact Registry identity must not bypass the Mac without completed orientation proof for the same stored pair.",
);
assert.ok(
  exact.includes("previousInstaComp.imageOrientationPersisted === true") &&
    exact.includes("previousInstaComp.imagePersistenceVerified === true"),
  "Legacy completed/persisted orientation proof must remain reusable only with verified stored pixels.",
);
assert.ok(
  accept.includes("imageOrientationVerified: true"),
  "Seller-accepted orientation must persist the durable verified flag.",
);
assert.ok(
  auto.includes(
    'imageOrientationVerified:\n          normalizedSides.orientation.status === "completed"',
  ),
  "Automatic orientation must mark verified only after a completed receipt.",
);
assert.ok(
  storage.includes(
    'imageOrientationVerified: params.orientation.status === "completed"',
  ),
  "Normalized storage must persist verified status only for completed orientation.",
);

console.log("PASS InstaComp orientation continuity regression");
