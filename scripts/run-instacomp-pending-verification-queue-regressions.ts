import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
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
    listingWorkflow: { queue: "pending_verification" },
    instacomp: {
      ...verifiedOrientation.instacomp,
      identityComplete: true,
      lastStatus: "identity_complete",
    },
  }),
  "listings",
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
const clientSource = readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8");
const migrationSource = readFileSync(
  "scripts/move-legacy-instacomp-to-pending-verification.mjs",
  "utf8",
);
const scannerSource = readFileSync(
  "src/app/kingmaker/KingmakerInstaCompQueue.tsx",
  "utf8",
);

assert.match(routeSource, /for \(let from = 0; ; from \+= 1000\)/);
assert.match(routeSource, /queueCounts/);
assert.match(routeSource, /requestedQueue === "verification"/);
assert.match(clientSource, /Resale Pending/);
assert.match(clientSource, /Pending Verification/);
assert.match(pageSource, /instacomp-pending\?queue=\$\{queue\}/);
assert.doesNotMatch(
  scannerSource,
  /identityComplete === true &&\s*result\.pricingSucceeded !== false/,
);
assert.match(migrationSource, /--expected-count=/);
assert.match(migrationSource, /--approved/);
assert.match(migrationSource, /reversible: true/);
assert.match(migrationSource, /\.eq\("status", "draft"\)/);

console.log("InstaComp Pending Verification queue regressions passed.");


function assertMacPendingProjectionContract() {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/account/seller/instacomp-pending/route.ts",
    ),
    "utf8",
  );
  assert.match(source, /getConfiguredInstaCompMacUrl/);
  assert.match(source, /mac_local_pending_projection/);
  assert.match(source, /identityComplete === true/);
  assert.match(source, /trustedForIdentity === true/);
  assert.match(source, /fingerprintSha256/);
}
assertMacPendingProjectionContract();


function assertMacMarketUsesCanonicalArchiveIdentity() {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/account/seller/inventory/instacomp/route.ts",
    ),
    "utf8",
  );
  assert.match(source, /getInstaCompAiLocalScanArchive/);
  assert.match(source, /mac_checklist_registry_exact/);
  assert.match(source, /internalChecklistIdentityId/);
  assert.match(source, /internalChecklistFingerprintSha256/);
  assert.match(source, /include_active: true/);
  assert.match(source, /ai: marketAi/);
}
assertMacMarketUsesCanonicalArchiveIdentity();
