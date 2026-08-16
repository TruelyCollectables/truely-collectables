import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  shouldApplyInstaCompChecklistPublicRateLimit,
  shouldApplyInstaCompRegistryLockPublicRateLimit,
} from "../src/lib/instacomp-checklist-rate-limit-policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  shouldApplyInstaCompChecklistPublicRateLimit("service_token") === false,
  "Authenticated InstaComp service-token checklist traffic must never use the public rate limiter",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit("seller_bearer") === true,
  "Seller bearer checklist traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit("admin_same_origin") === true,
  "Browser-admin checklist traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompChecklistPublicRateLimit(null) === true,
  "Unknown checklist security channels must fail closed by remaining rate limited",
);

assert(
  shouldApplyInstaCompRegistryLockPublicRateLimit({
    channel: "service_token",
    sentinelMacRequest: false,
  }) === false,
  "Authenticated InstaComp service-token Registry-lock traffic must never use the public rate limiter",
);
assert(
  shouldApplyInstaCompRegistryLockPublicRateLimit({
    channel: null,
    sentinelMacRequest: true,
  }) === false,
  "Authenticated Sentinel Mac Registry-lock traffic must never use the public rate limiter",
);
assert(
  shouldApplyInstaCompRegistryLockPublicRateLimit({
    channel: "seller_bearer",
    sentinelMacRequest: false,
  }) === true,
  "Seller bearer Registry-lock traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompRegistryLockPublicRateLimit({
    channel: "admin_same_origin",
    sentinelMacRequest: false,
  }) === true,
  "Browser-admin Registry-lock traffic must remain rate limited",
);
assert(
  shouldApplyInstaCompRegistryLockPublicRateLimit({
    channel: null,
    sentinelMacRequest: false,
  }) === true,
  "Unknown Registry-lock channels must fail closed by remaining rate limited",
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checklistRoutePath = path.join(
  root,
  "src/app/api/instacomp/checklist-lookup/route.ts",
);
const checklistRoute = fs.readFileSync(checklistRoutePath, "utf8");
const checklistActorIndex = checklistRoute.indexOf("requireInstaCompJobActor(req)");
const checklistSecurityIndex = checklistRoute.indexOf(
  "assertTrustedInstaCompMutationRequest",
);
const checklistPolicyIndex = checklistRoute.indexOf(
  "shouldApplyInstaCompChecklistPublicRateLimit(security.channel)",
);
const checklistLimiterIndex = checklistRoute.indexOf("checkPublicEndpointRateLimit({");

assert(checklistActorIndex >= 0, "Checklist route must authenticate an InstaComp actor");
assert(
  checklistSecurityIndex > checklistActorIndex,
  "Checklist route must validate the trusted mutation channel after actor authentication",
);
assert(
  checklistPolicyIndex > checklistSecurityIndex,
  "Checklist route must decide throttling only after trusted-channel validation",
);
assert(
  checklistLimiterIndex > checklistPolicyIndex,
  "Checklist public limiter must be downstream of the service-token bypass decision",
);
assert(
  checklistRoute.includes('endpointKey: "instacomp_checklist_lookup"'),
  "Seller/admin checklist traffic must retain the existing public limiter bucket",
);
assert(
  checklistRoute.includes("maxAttempts: 2000"),
  "Seller/admin checklist traffic must retain the existing 2,000/day ceiling",
);

const registryRoutePath = path.join(
  root,
  "src/app/api/instacomp/registry-lock/route.ts",
);
const registryRoute = fs.readFileSync(registryRoutePath, "utf8");
const sentinelAuthIndex = registryRoute.indexOf(
  "isValidInstaCompSentinelArchiveRequest(req)",
);
const registryActorIndex = registryRoute.indexOf("requireInstaCompJobActor(req)");
const registrySecurityIndex = registryRoute.indexOf(
  "assertTrustedInstaCompMutationRequest",
);
const registryPolicyIndex = registryRoute.indexOf(
  "shouldApplyInstaCompRegistryLockPublicRateLimit({",
);
const registryLimiterIndex = registryRoute.indexOf("checkPublicEndpointRateLimit({");

assert(sentinelAuthIndex >= 0, "Registry-lock route must authenticate the Sentinel Mac channel");
assert(registryActorIndex > sentinelAuthIndex, "Registry-lock service/seller actor authentication must remain present");
assert(
  registrySecurityIndex > registryActorIndex,
  "Registry-lock trusted mutation validation must remain downstream of actor authentication",
);
assert(
  registryPolicyIndex > registrySecurityIndex,
  "Registry-lock bypass decision must happen only after internal credentials are validated",
);
assert(
  registryLimiterIndex > registryPolicyIndex,
  "Registry-lock public limiter must be downstream of the trusted-internal bypass decision",
);
assert(
  registryRoute.includes('endpointKey: "instacomp_registry_lock"'),
  "Seller/admin Registry-lock traffic must retain the existing public limiter bucket",
);
assert(
  registryRoute.includes("maxAttempts: 2000"),
  "Seller/admin Registry-lock traffic must retain the existing 2,000/day ceiling",
);

console.log("PASS service_token checklist and Registry-lock traffic bypasses the public limiter");
console.log("PASS Sentinel Mac Registry-lock traffic bypasses the public limiter");
console.log("PASS seller/admin Registry traffic remains protected by the public limiter");
console.log("PASS authentication and trusted-channel validation occur before every bypass");
