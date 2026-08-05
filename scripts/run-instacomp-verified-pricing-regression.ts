import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const verifiedRoute = readFileSync(
  "src/app/api/account/seller/inventory/instacomp-verified/route.ts",
  "utf8",
);
const nextConfig = readFileSync("next.config.ts", "utf8");
const sharedClient = readFileSync(
  "src/lib/instacomp-verified-pricing-client.ts",
  "utf8",
);

const verifyImport = verifiedRoute.indexOf(
  'import { POST as verifyPendingIdentity } from "../../instacomp-pending-identity/route";',
);
const pricingImport = verifiedRoute.indexOf(
  'import { POST as runUniversalInstaComp } from "../instacomp-universal/route";',
);
const verifyCall = verifiedRoute.indexOf(
  "const verification = await verifyPendingIdentity(verificationRequest);",
);
const verificationGate = verifiedRoute.indexOf(
  "if (!verification.ok || verificationPayload?.success !== true)",
);
const pricingCall = verifiedRoute.indexOf(
  "const response = await runUniversalInstaComp(pricingRequest);",
);

assert.ok(verifyImport >= 0, "verified pricing route must import Registry verification");
assert.ok(pricingImport >= 0, "verified pricing route must import universal marketplace pricing");
assert.ok(verifyCall >= 0, "verified pricing route must execute Registry verification");
assert.ok(
  verificationGate > verifyCall,
  "verification failure must be handled after verification",
);
assert.ok(
  pricingCall > verificationGate,
  "marketplace pricing must execute only after the Registry verification gate",
);
assert.match(
  verifiedRoute,
  /code:\s*"CHECKLIST_IDENTITY_REQUIRED"/,
  "unresolved Registry identities must return a stable blocking code",
);
assert.match(
  verifiedRoute,
  /instaCompResponseHeaders\(\{[\s\S]*checklistVerified:\s*true/,
  "successful verified pricing must expose a verification receipt header",
);
assert.match(
  nextConfig,
  /source:\s*"\/api\/account\/seller\/inventory\/instacomp"[\s\S]*destination:\s*"\/api\/account\/seller\/inventory\/instacomp-verified"/,
  "the public seller pricing URL must route through verified pricing",
);
assert.match(
  sharedClient,
  /\/api\/account\/seller\/inventory\/instacomp-verified/,
  "the shared client must use verified single-card pricing",
);
assert.match(
  sharedClient,
  /\/api\/account\/seller\/inventory\/instacomp-verified-batch/,
  "the shared client must use verified server batch pricing",
);
assert.doesNotMatch(
  verifiedRoute,
  /runLegacySellerInstaComp|runInventoryInstaComp/,
  "verified pricing must not call the legacy pricing route directly",
);

console.log("InstaComp verified pricing regression passed.");
