import { existsSync, readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message);
}

function requireOrder(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(message);
  }
}

const config = read("next.config.ts");
const verified = read(
  "src/app/api/account/seller/inventory/instacomp-verified/route.ts",
);
const contract = read("src/lib/instacomp-api-contract.ts");
const universal = read(
  "src/app/api/account/seller/inventory/instacomp-universal/route.ts",
);
const layout = read("src/app/seller/instacomp-pending/layout.tsx");
const dashboard = read(
  "src/app/seller/instacomp-pending/ChecklistReadinessDashboard.tsx",
);
const publish = read(
  "src/app/api/account/seller/instacomp-pending/publish/route.ts",
);

requireText(
  config,
  'destination: "/api/account/seller/inventory/instacomp-verified"',
  "The public seller pricing route must rewrite to Registry-verified pricing.",
);
if (
  config.includes(
    'source: "/api/account/seller/inventory/instacomp",\n          destination: "/api/account/seller/inventory/instacomp-universal"',
  )
) {
  throw new Error("The public seller pricing route still bypasses Registry verification.");
}

requireText(
  verified,
  'import { POST as verifyPendingIdentity }',
  "Verified pricing must import Registry verification.",
);
requireText(
  verified,
  'import { POST as runUniversalInstaComp }',
  "Verified pricing must preserve the universal marketplace engine.",
);
requireOrder(
  verified,
  "await verifyPendingIdentity",
  "await runUniversalInstaComp",
  "Registry verification must finish before universal marketplace pricing starts.",
);
requireText(
  verified,
  "instaCompResponseHeaders({",
  "Verified pricing must use the standard response receipt helper.",
);
requireText(
  verified,
  "checklistVerified: true",
  "Successful pricing must issue the Registry verification response header.",
);
requireText(
  contract,
  'headers.set(\n      "x-instacomp-checklist-verified"',
  "The shared response contract must emit the Registry verification header.",
);
requireText(
  verified,
  "identity,",
  "Successful pricing must return the typed Registry identity receipt.",
);
requireText(
  universal,
  'import { POST as runLegacySellerInstaComp } from "../instacomp/route"',
  "Universal pricing must call the internal pricing engine directly.",
);

if (existsSync("src/app/seller/instacomp-pending/ChecklistIdentityGuard.tsx")) {
  throw new Error("The obsolete browser fetch interceptor still exists.");
}
if (layout.includes("ChecklistIdentityGuard")) {
  throw new Error("Pending Listings still depends on browser fetch interception.");
}
requireText(
  layout,
  "<ChecklistReadinessDashboard />",
  "Pending Listings must render Registry readiness directly.",
);
requireText(
  dashboard,
  "runVerifiedInstaCompPricingBatch",
  "The seller work queue must use the shared verified batch client.",
);
requireText(
  dashboard,
  "runVerifiedInstaCompPricing",
  "The seller work queue must support verified single-card retry.",
);
for (const requiredLabel of [
  "Canonical identity not locked",
  "Fingerprint",
  "Publish ready",
  "Re-identify + price",
]) {
  requireText(dashboard, requiredLabel, `Dashboard is missing ${requiredLabel}.`);
}
requireText(
  publish,
  "assertChecklistRegistryReceipt",
  "Publishing must retain the server-side Registry receipt firewall.",
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      publicPricingRoute: "registry_verified",
      marketplaceEngine: "universal",
      browserFetchInterceptor: false,
      perCardRegistryQueue: true,
      versionedReceiptHeaders: true,
      publishFirewall: true,
    },
    null,
    2,
  ),
);
