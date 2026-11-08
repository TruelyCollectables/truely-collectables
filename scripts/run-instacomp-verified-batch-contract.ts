import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  "src/app/api/account/seller/inventory/instacomp-verified-batch/route.ts",
  "utf8",
);
const client = readFileSync(
  "src/lib/instacomp-verified-pricing-client.ts",
  "utf8",
);

assert.ok(
  route.includes('import { POST as runVerifiedPricing } from "../instacomp-verified/route"'),
  "batch route must invoke the verified pricing route",
);
assert.ok(
  !route.includes('from "../instacomp/route"'),
  "batch route must never invoke the unverified pricing route",
);
assert.ok(
  route.includes('headers.set("x-instacomp-batch-checklist-enforced", "true")'),
  "batch route must emit its checklist enforcement receipt",
);
assert.ok(
  route.includes("instaCompResponseHeaders"),
  "batch route must preserve the versioned shared response contract",
);
assert.ok(
  route.includes("MAX_BATCH_SIZE = 50"),
  "batch route must preserve the 50-card safety limit",
);
assert.ok(
  route.includes("MAX_CONCURRENCY = 3"),
  "batch route must preserve bounded server concurrency",
);
assert.ok(
  client.includes("CHECKLIST_IDENTITY_REQUIRED"),
  "shared client must preserve the stable review-required error code",
);
assert.ok(
  client.includes("ChecklistIdentityRequiredError"),
  "shared client must expose a typed checklist blocker",
);
assert.ok(
  client.includes("runVerifiedInstaCompPricingBatch"),
  "shared client must expose batch execution for web and Mobile",
);
assert.ok(
  client.includes("/api/account/seller/inventory/instacomp-verified-batch"),
  "shared client must use the protected server batch endpoint",
);

console.log("InstaComp verified batch contract passed.");
