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
    instacomp: {
      ...verifiedOrientation.instacomp,
      identityComplete: true,
      trustedForIdentity: true,
      checklistIdentity: {
        status: "exact_match",
        identityId: "registry-1",
        fingerprintSha256: "fingerprint-1",
      },
      frontImageUrl: "/front",
      backImageUrl: "/back",
    },
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
  "verification",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    instacomp: {
      imageOrientation: { status: "completed" },
      imageOrientationPersisted: true,
      identityComplete: true,
      lastStatus: "identity_complete",
      frontImageUrl: "/api/kingmaker/scan-image?side=front",
      backImageUrl: "/api/kingmaker/scan-image?side=back",
    },
    listing_workflow: { queue: "pending_verification" },
  }),
  "verification",
);

assert.equal(
  instaCompPendingQueueFromMetadata({
    instacomp: {
      imageOrientation: { status: "review_required" },
      imageOrientationPersisted: false,
      imagePersistenceVerified: true,
      identityComplete: true,
      trustedForIdentity: true,
      lastStatus: "identity_complete",
      checklistIdentity: {
        status: "exact_match",
        identityId: "registry-exact-1",
      },
      frontImageUrl: "/api/kingmaker/scan-image?scanId=x&side=front",
      backImageUrl: "/api/kingmaker/scan-image?scanId=x&side=back",
    },
    listingWorkflow: { queue: "pending_verification" },
  }),
  "verification",
);

assert.equal(
  instaCompPendingQueueFromMetadata({
    instacomp: {
      imageOrientation: { status: "review_required" },
      imageOrientationPersisted: false,
      identityComplete: true,
      trustedForIdentity: false,
      checklistIdentity: {
        status: "exact_match",
        identityId: "registry-exact-1",
      },
      frontImageUrl: "/api/kingmaker/scan-image?scanId=x&side=front",
      backImageUrl: "/api/kingmaker/scan-image?scanId=x&side=back",
    },
    listingWorkflow: { queue: "pending_verification" },
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
const pageSource = readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8");
const pageWrapperSource = readFileSync("src/app/kingmaker/pending/page.tsx", "utf8");
const scannerSource = readFileSync("src/app/kingmaker/KingmakerInstaCompQueue.tsx", "utf8");
const intakeSource = readFileSync("src/app/api/account/seller/instacomp-scan/intake/route.ts", "utf8");
const pendingIdentitySource = readFileSync("src/app/api/account/seller/instacomp-pending-identity/route.ts", "utf8");
const migrationSource = readFileSync(
  "scripts/move-legacy-instacomp-to-pending-verification.mjs",
  "utf8",
);

assert.match(routeSource, /for \(let from = 0; ; from \+= 1000\)/);
assert.match(routeSource, /queueCounts/);
assert.match(routeSource, /requestedQueue === "verification"/);
assert.match(pageSource, /Pending Listings/);
assert.match(pageSource, /Pending Verification/);
assert.match(pageSource, /const hydrationMismatch =/);
assert.match(pageSource, /initialCards\.length === 0 && initialQueueCount > 0/);
assert.match(pageSource, /Queue data is refreshing/);
assert.match(pageWrapperSource, /instacomp-pending\?queue=\$\{queue\}/);
assert.match(scannerSource, /\/api\/account\/seller\/instacomp-scan\/intake/);
assert.doesNotMatch(scannerSource, /identityComplete === true &&\s*result\.pricingSucceeded !== false/);
assert.match(intakeSource, /identityComplete: true/);
assert.match(intakeSource, /pricingStatus: "identity_complete_pricing_pending"/);
assert.match(pendingIdentitySource, /runKingmakerMacScan/);
assert.match(pendingIdentitySource, /storedImageFile/);
assert.match(pendingIdentitySource, /recoveredFromStoredPairAt/);
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
  assert.match(source, /listMacKingmakerInventory/);
  assert.match(source, /mac_local_pending_projection/);
  assert.match(source, /identityComplete === true/);
  assert.match(source, /trustedForIdentity === true/);
  assert.match(source, /fingerprintSha256/);
  assert.match(source, /macReceivedReviewPendingRow/);
  assert.match(source, /mac_local_received_review/);
  assert.match(source, /existingInventoryIds/);
  assert.match(source, /kingmakerScanImageUrl/);
  assert.match(source, /textValue\(instaComp\.frontImageUrl\)/);
  assert.match(source, /textValue\(instaComp\.backImageUrl\)/);
  assert.match(source, /listMacKingmakerInventory\(10_000\)/);
  assert.match(source, /getMacKingmakerInventoryItems\(projectionCandidateIds, 750\)/);
  assert.match(source, /if \(queue === "verification"\) throw error/);
  assert.match(source, /existingChecklistIdentity\.fingerprintSha256/);
  assert.doesNotMatch(
    source,
    /listMacKingmakerInventory\(2_000\)\.catch\(\s*\(\) => null/,
  );
}
assertMacPendingProjectionContract();
