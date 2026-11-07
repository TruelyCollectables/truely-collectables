import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instaCompPendingQueueFromMetadata } from "../src/lib/instacomp-pending-queue";

const redo = {
  listingWorkflow: { queue: "redo_pending_resale", publicationGated: true },
  listingReviewRequired: true,
  instacomp: { listingPublishBlocked: true },
};
assert.equal(instaCompPendingQueueFromMetadata(redo), "redo_pending_resale");
assert.equal(instaCompPendingQueueFromMetadata({
  ...redo,
  instacomp: {
    ...redo.instacomp,
    frontImageUrl: "https://example.com/front.jpg",
    backImageUrl: "https://example.com/back.jpg",
    imageOrientation: { status: "review_required" },
  },
}), "redo_pending_resale");
assert.equal(instaCompPendingQueueFromMetadata({}), "verification");

const route = readFileSync("src/app/api/account/seller/instacomp-pending/route.ts","utf8");
const client = readFileSync("src/app/kingmaker/pending/PendingClient.tsx","utf8");
const page = readFileSync("src/app/kingmaker/pending/page.tsx","utf8");
const redirect = readFileSync("src/app/kingmaker/listings/page.tsx","utf8");

assert.match(route, /requestedQueue === "redo_pending_resale"/);
assert.match(route, /queueHint === "redo_pending_resale" && row.status === "draft"/);
assert.match(route, /row.status === "draft" && rowQueue === "redo_pending_resale"/);
assert.match(route, /redo_pending_resale: Number\(macProjection.queueCounts.redo_pending_resale/);
assert.match(route, /getInventoryActivationBlockers/);
assert.match(client, /REDO Resale Pending/);
assert.match(client, /queueCounts\[queue\]/);
assert.match(client, /queue === "redo_pending_resale"\) \{/);
assert.match(client, /queue !== "verification" && queue !== "redo_pending_resale"/);
assert.match(client, /accept-verification/);
assert.match(client, /const \[renderLimit, setRenderLimit\] = useState\(24\)/);
assert.match(page, /queue === "redo_pending_resale"/);
assert.match(redirect, /query.queue === "redo_pending_resale"/);
console.log("Kingmaker REDO seller-review visibility and publish gates: PASS");
