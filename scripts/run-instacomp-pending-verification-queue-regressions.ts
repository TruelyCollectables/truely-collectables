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
  "verification",
  "orientation alone must never certify card identity",
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
  "identityComplete without the exact Mac Registry receipt must stay in verification",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    listingWorkflow: { queue: "pending_verification" },
    instacomp: {
      ...verifiedOrientation.instacomp,
      identityComplete: true,
      trustedForIdentity: true,
      registryIdentityId: "11111111-1111-4111-8111-111111111111",
      registryFingerprintSha256: "fingerprint-1",
      checklistDecision: { status: "exact_match" },
      checklistIdentity: {
        status: "identified",
        source: "checklist_registry",
        registryIdentityId: "11111111-1111-4111-8111-111111111111",
        registryFingerprintSha256: "fingerprint-1",
      },
      macReceipt: { checklistOutcome: "exact_match" },
    },
  }),
  "listings",
  "a complete exact Mac Registry receipt may promote the card",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    listingWorkflow: { queue: "pending_verification" },
    instacomp: {
      ...verifiedOrientation.instacomp,
      identityComplete: true,
      manualIdentityLocked: true,
    },
  }),
  "listings",
  "seller manual identity locks remain protected",
);
assert.equal(
  instaCompPendingQueueFromMetadata({
    listingWorkflow: { queue: "pending_verification" },
    instacomp: {
      ...verifiedOrientation.instacomp,
      identityComplete: true,
      trustedForIdentity: true,
      identitySource: "mac_checklist_registry_exact",
      checklistDecision: { status: "exact_match" },
      checklistIdentity: {
        status: "exact_match",
        identityId: "22222222-2222-4222-8222-222222222222",
        fingerprintSha256: "fingerprint-2",
      },
    },
  }),
  "listings",
  "current Mac-local exact UUID/fingerprint receipt may promote the card",
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


function assertPriceGuideInstaCompContract() {
  const marketRoute = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/account/seller/inventory/instacomp/route.ts",
    ),
    "utf8",
  );
  const pendingRoute = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/account/seller/instacomp-pending/route.ts",
    ),
    "utf8",
  );
  const pendingClient = readFileSync(
    path.join(
      process.cwd(),
      "src/app/kingmaker/pending/PendingClient.tsx",
    ),
    "utf8",
  );
  const priceGuideBackfillRoute = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/account/seller/instacomp-price-guide/route.ts",
    ),
    "utf8",
  );
  assert.match(marketRoute, /include_price_guide: true/);
  assert.match(marketRoute, /priceGuide: macMarket\.priceGuide/);
  assert.match(pendingRoute, /priceGuideCheckedAt/);
  assert.match(pendingRoute, /priceGuideCoverage/);
  assert.match(priceGuideBackfillRoute, /include_price_guide: true/);
  assert.match(priceGuideBackfillRoute, /priceGuideStatus/);
  assert.match(priceGuideBackfillRoute, /priorLiveWindowIsOneYear/);
  assert.match(pendingClient, /eBay Price Guide · 1 year/);
  assert.match(pendingClient, /1-year refresh required/);
  assert.match(pendingClient, /period_mismatch/);
  assert.match(pendingClient, /refreshPriceGuide/);
  assert.match(pendingClient, /Checking eBay Price Guide automatically/);
  assert.match(pendingClient, /CHECKED — eBay did not expose an exact-card Price Guide dataset/);
  assert.match(pendingClient, /function PriceGuidePanel/);
  assert.match(pendingClient, /Weekly median sold trend/);
  assert.match(pendingClient, /exact sold transactions remain InstaComp pricing authority/);
  assert.match(pendingRoute, /centering/);
  assert.match(pendingClient, /CENTERING ESTIMATE/);
  assert.match(pendingClient, /LEFT \/ RIGHT/);
  assert.match(pendingClient, /TOP \/ BOTTOM/);
  assert.match(pendingClient, /InstaComp will not invent a centering number/);
  assert.doesNotMatch(pendingClient, /CYAN 45\/55/);
  assert.doesNotMatch(pendingClient, /Centering guide ON/);
}
assertPriceGuideInstaCompContract();
