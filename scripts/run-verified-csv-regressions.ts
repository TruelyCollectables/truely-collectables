import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instaCompPendingQueueFromMetadata } from "../src/lib/instacomp-pending-queue";
import { getInventoryActivationBlockers } from "../src/lib/inventory-activation";
import { hasVerifiedCsvAuthority } from "../src/lib/kingmaker-verified-csv";
import { createDualMarketplaceListingDraft } from "../src/lib/dual-marketplace-listing";
const fixtures = JSON.parse(readFileSync("scripts/fixtures/verified-csv-fixtures.json","utf8"));
let count = 0;
for (const [name,item] of Object.entries(fixtures) as [string, any][]) {
  assert.equal(hasVerifiedCsvAuthority(item.metadata), true);
  assert.equal(instaCompPendingQueueFromMetadata(item.metadata), "listings");
  const blockers = getInventoryActivationBlockers({ ...item, price: 0, metadata: item.metadata });
  assert.deepEqual(blockers, ["missing_price"], name);
  assert.deepEqual(getInventoryActivationBlockers({ ...item, price: 25, metadata: item.metadata }), [], name);
  const draft = createDualMarketplaceListingDraft(item);
  assert.equal(draft.identity.player, "Verified Fixture");
  assert.equal(draft.identity.cardNumber, "007");
  assert.equal(draft.identity.isAuto, name === "autograph");
  if (name === "slab") { assert.equal(draft.grader, "PSA"); assert.equal(draft.grade, "10"); assert.equal(draft.certificationNumber, "fixture-cert-001"); }
  assert.ok(item.metadata.instacomp.frontImageUrl.startsWith("https://truelycollectables.com/api/kingmaker/verified-csv/image?"));
  count += 8;
}
const bad = structuredClone(fixtures.raw.metadata);
bad.instacomp.manualIdentityLocked = false;
assert.equal(hasVerifiedCsvAuthority(bad), false);
assert.equal(instaCompPendingQueueFromMetadata(bad), "verification");
const missingBack = structuredClone(fixtures.raw.metadata);
missingBack.instacomp.backSha256 = "";
assert.equal(hasVerifiedCsvAuthority(missingBack), false);
assert.equal(instaCompPendingQueueFromMetadata(missingBack), "verification");
assert.equal(instaCompPendingQueueFromMetadata({}), "verification");
console.log("PASS: "+(count+5)+" assertions: raw/autograph/slab/patch CSV cards bypass AI verification, pricing is the only activation blocker, listing identity/images preserved, forged/unlocked receipts rejected.");
