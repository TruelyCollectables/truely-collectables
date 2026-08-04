import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const verifiedRoute = readFileSync(
  "src/app/api/account/seller/inventory/instacomp-verified/route.ts",
  "utf8",
);
const pendingPage = readFileSync(
  "src/app/seller/instacomp-pending/page.tsx",
  "utf8",
);

const verifyImport = verifiedRoute.indexOf(
  'import { POST as verifyPendingIdentity } from "../../instacomp-pending-identity/route";',
);
const pricingImport = verifiedRoute.indexOf(
  'import { POST as runInventoryInstaComp } from "../instacomp/route";',
);
const verifyCall = verifiedRoute.indexOf(
  "const verification = await verifyPendingIdentity(verificationRequest);",
);
const verificationGate = verifiedRoute.indexOf("if (!verification.ok)");
const pricingCall = verifiedRoute.indexOf(
  "const response = await runInventoryInstaComp(pricingRequest);",
);

assert.ok(verifyImport >= 0, "verified pricing route must import Registry verification");
assert.ok(pricingImport >= 0, "verified pricing route must import marketplace pricing");
assert.ok(verifyCall >= 0, "verified pricing route must execute Registry verification");
assert.ok(verificationGate > verifyCall, "verification failure must be handled after verification");
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
  /x-instacomp-checklist-verified/,
  "successful verified pricing must expose a verification receipt header",
);
assert.match(
  pendingPage,
  /\/api\/account\/seller\/inventory\/instacomp-verified/,
  "Pending Listings must call the verified pricing endpoint",
);
assert.doesNotMatch(
  pendingPage,
  /fetch\(\s*["']\/api\/account\/seller\/inventory\/instacomp["']/,
  "Pending Listings must never call the unverified pricing endpoint directly",
);

console.log("InstaComp verified pricing regression passed.");
