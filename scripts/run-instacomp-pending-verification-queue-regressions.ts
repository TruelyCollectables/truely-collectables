import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  instaCompPendingQueueFromMetadata,
} from "../src/lib/instacomp-pending-queue";

const verifiedOrientation = {
  instacomp: {
    imageOrientation: { status: "completed" },
    imageOrientationPersisted: true,
    imagePersistenceVerified: true,
  },
};

assert.equal(instaCompPendingQueueFromMetadata(null), "verification");
assert.equal(
  instaCompPendingQueueFromMetadata({
    ...verifiedOrientation,
    listingWorkflow: { queue: "pending_listings" },
  }),
  "listings",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    listingWorkflow: { queue: "pending_listings" },
    instacomp: {
      imageOrientation: { status: "review_required" },
      imageOrientationPersisted: false,
      imagePersistenceVerified: true,
    },
  }),
  "verification",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    ...verifiedOrientation,
    listingWorkflow: { queue: "pending_verification" },
  }),
  "verification",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    ...verifiedOrientation,
    listing_workflow: { queue: "pending_verification" },
  }),
  "verification",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    ...verifiedOrientation,
    pending_verification: { status: "pending" },
  }),
  "verification",
);

const routeSource = readFileSync(
  "src/app/api/account/seller/instacomp-pending/route.ts",
  "utf8",
);
const pageSource = readFileSync("src/app/kingmaker/pending/page.tsx", "utf8");
const migrationSource = readFileSync(
  "scripts/move-legacy-instacomp-to-pending-verification.mjs",
  "utf8",
);

assert.match(routeSource, /for \(let from = 0; ; from \+= 1000\)/);
assert.match(routeSource, /queueCounts/);
assert.match(routeSource, /requestedQueue === "verification"/);
assert.match(pageSource, /Pending Listings/);
assert.match(pageSource, /Pending Verification/);
assert.match(pageSource, /instacomp-pending\?queue=\$\{queue\}/);
assert.match(migrationSource, /--expected-count=/);
assert.match(migrationSource, /--approved/);
assert.match(migrationSource, /reversible: true/);
assert.match(migrationSource, /\.eq\("status", "draft"\)/);

console.log("InstaComp Pending Verification queue regressions passed.");
