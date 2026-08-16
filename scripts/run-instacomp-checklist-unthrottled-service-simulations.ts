import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shouldApplyInstaCompChecklistPublicRateLimit } from "../src/lib/instacomp-checklist-rate-limit-policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  shouldApplyInstaCompChecklistPublicRateLimit("service_token") === false,
  "Authenticated InstaComp service-token traffic must never use the public rate limiter",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit("seller_bearer") === true,
  "Seller bearer traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit("admin_same_origin") === true,
  "Browser-admin traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit(null) === true,
  "Unknown security channels must fail closed by remaining rate limited",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routePath = path.join(
  root,
  "src/app/api/instacomp/checklist-lookup/route.ts",
);
const route = fs.readFileSync(routePath, "utf8");
const actorIndex = route.indexOf("requireInstaCompJobActor(req)");
const securityIndex = route.indexOf("assertTrustedInstaCompMutationRequest");
const policyIndex = route.indexOf(
  "shouldApplyInstaCompChecklistPublicRateLimit(security.channel)",
);
const limiterIndex = route.indexOf("checkPublicEndpointRateLimit({");

assert(actorIndex >= 0, "Checklist route must authenticate an InstaComp actor");
assert(
  securityIndex > actorIndex,
  "Checklist route must validate the trusted mutation channel after actor authentication",
);
assert(
  policyIndex > securityIndex,
  "Checklist route must decide throttling only after trusted-channel validation",
);
assert(
  limiterIndex > policyIndex,
  "Public rate limiter must be downstream of the service-token bypass decision",
);
assert(
  route.includes('endpointKey: "instacomp_checklist_lookup"'),
  "Seller/admin checklist traffic must retain the existing public limiter bucket",
);
assert(
  route.includes("maxAttempts: 2000"),
  "Seller/admin checklist traffic must retain the existing 2,000/day ceiling",
);

console.log("PASS service_token checklist traffic bypasses the public rate limiter");
console.log("PASS seller/admin checklist traffic remains protected by the public limiter");
console.log("PASS authentication and trusted-channel validation occur before the bypass");
