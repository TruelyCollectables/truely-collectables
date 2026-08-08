import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());

function read(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) throw new Error(`Missing required file: ${path}`);
  return readFileSync(absolute, "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required contract: ${expected}`);
  }
}

function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden contract: ${forbidden}`);
  }
}

function filesUnder(directory) {
  const absolute = resolve(root, directory);
  const output = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) output.push(...filesUnder(path));
    else output.push(path);
  }
  return output;
}

const wrappers = new Map([
  ["src/app/kingmaker/scan/page.tsx", "../../seller/instacomp-scan/page"],
  ["src/app/kingmaker/inventory/page.tsx", "../../seller/inventory/page"],
  ["src/app/kingmaker/orders/page.tsx", "../../seller/orders/page"],
  ["src/app/kingmaker/marketplaces/page.tsx", "../../seller/marketplaces/page"],
  ["src/app/kingmaker/payouts/page.tsx", "../../seller/payouts/page"],
]);

for (const [path, target] of wrappers) {
  const source = read(path).trim();
  const expected =
    path === "src/app/kingmaker/marketplaces/page.tsx"
      ? [
          'export const dynamic = "force-dynamic";',
          "export const revalidate = 0;",
          "",
          `export { default } from "${target}";`,
        ].join("\n")
      : `export { default } from "${target}";`;
  if (source !== expected) {
    throw new Error(
      path === "src/app/kingmaker/marketplaces/page.tsx"
        ? `${path} must remain a force-dynamic, zero-revalidate thin wrapper around ${target}.`
        : `${path} must remain a thin wrapper around ${target}.`,
    );
  }
}

const auditedPending = read("src/app/kingmaker/pending/page.tsx");
for (const required of [
  "function hasValidPair(card: PendingCard)",
  "card.frontImageUrl !== card.backImageUrl",
  '"/api/account/seller/inventory/instacomp-front-back"',
  "replaceManualIdentity",
  'aiCouncilTier: "adaptive"',
  "Re-scan and Replace Locked Identity",
  "Save, Lock & Teach InstaComp",
  "job?.error",
  "Blank no longer means Base.",
  "No Base or look-alike parallel was substituted.",
  "never auto-published",
]) {
  requireText(auditedPending, required, "audited KINGMAKER Pending Listings");
}
for (const forbidden of [
  "failed: 100",
  'formData.set("frontImage", frontImage)',
  'formData.set("backImage", backImage)',
]) {
  rejectText(auditedPending, forbidden, "audited KINGMAKER Pending Listings");
}

for (const existingPath of [
  "src/app/seller/instacomp-scan/page.tsx",
  "src/app/seller/instacomp-pending/page.tsx",
  "src/app/seller/inventory/page.tsx",
  "src/app/seller/orders/page.tsx",
  "src/app/seller/marketplaces/page.tsx",
  "src/app/seller/payouts/page.tsx",
]) {
  read(existingPath);
}

const shell = read("src/app/kingmaker/KingmakerShell.tsx");
for (const route of [
  "/kingmaker/scan",
  "/kingmaker/pending",
  "/kingmaker/inventory",
  "/kingmaker/intelligence",
  "/kingmaker/sourcing",
  "/kingmaker/offers",
  "/kingmaker/orders",
  "/kingmaker/marketplaces",
  "/kingmaker/payouts",
  "/kingmaker/settings",
]) {
  requireText(shell, route, "KINGMAKER navigation");
}
requireText(shell, "Registry controls identity", "KINGMAKER shell");
requireText(shell, "Seller approval controls execution", "KINGMAKER shell");

const capabilityRegistry = read("src/lib/instacomp-capabilities.ts");
for (const capability of [
  "scan_identification",
  "registry_resolution",
  "marketplace_comps",
  "price_recommendation",
  "market_research",
  "release_research",
  "grader_verification",
  "listing_content",
  "sourcing_analysis",
  "inventory_repricing",
]) {
  requireText(capabilityRegistry, `${capability}:`, "capability registry");
}
requireText(
  capabilityRegistry,
  'canonicalIdentityAuthority: "central_checklist_registry"',
  "capability registry",
);
requireText(
  capabilityRegistry,
  'executionOwner: "kingmaker"',
  "capability registry",
);
requireText(
  capabilityRegistry,
  "sellerMutationAllowed: false",
  "capability registry",
);
rejectText(
  capabilityRegistry,
  "sellerMutationAllowed: true",
  "capability registry",
);

const evidence = read("src/lib/instacomp-evidence-contract.ts");
for (const field of [
  "sourceName:",
  "sourceCategory:",
  "sourceIdentifier:",
  "retrievedAt:",
  "observedAt:",
  "confidence:",
  "matchScore:",
  "registryIdentityId:",
  "registryFingerprint:",
  "disposition:",
  "rejectionReason:",
  "freshnessExpiresAt:",
]) {
  requireText(evidence, field, "evidence contract");
}
requireText(
  evidence,
  "Every research fact requires source provenance.",
  "evidence validation",
);

const research = read("src/lib/instacomp-research-contract.ts");
for (const field of [
  "jobId:",
  "requestId:",
  "sellerId:",
  "storeId:",
  "capability:",
  "subject:",
  "requestedSources:",
  "status:",
  "evidence:",
  "recommendation:",
  "confidence:",
  "blockers:",
  "failureCode:",
  "auditReceipt:",
]) {
  requireText(research, field, "research-job contract");
}
requireText(research, "sellerApprovalRequired: true", "recommendation contract");
requireText(research, "executableByInstaComp: false", "recommendation contract");

const boundaries = read("src/lib/kingmaker-instacomp-boundaries.ts");
for (const errorCode of [
  "CHECKLIST_IDENTITY_REQUIRED",
  "INSTACOMP_SELLER_MUTATION_FORBIDDEN",
  "SELLER_AUTHENTICATION_REQUIRED",
  "SELLER_PERMISSION_REQUIRED",
  "SELLER_APPROVAL_REQUIRED",
  "LISTING_READINESS_BLOCKED",
]) {
  requireText(boundaries, errorCode, "execution boundary");
}
requireText(
  boundaries,
  "assertCanonicalRegistryIdentity(params.registryIdentity)",
  "research identity gate",
);
requireText(
  boundaries,
  "assertCanonicalRegistryIdentity(authorization.registryIdentity)",
  "seller execution identity gate",
);

const kingmakerFiles = filesUnder("src/app/kingmaker");
for (const absolutePath of kingmakerFiles) {
  const source = readFileSync(absolutePath, "utf8");
  const label = relative(root, absolutePath);
  for (const forbidden of [
    "suggestedPrice * 1.05",
    "suggestedPrice * 1.1",
    "checkout.session.completed",
    "acceptOffer(",
    "publishListing(",
    "registry.match(",
  ]) {
    rejectText(source, forbidden, label);
  }
}

const macMain = read("services/instacomp-ai/app/main.py");
for (const forbiddenImport of [
  "from .publishing",
  "from .offers",
  "from .orders",
  "from .inventory",
]) {
  rejectText(macMain, forbiddenImport, "Mac InstaComp service");
}
requireText(macMain, "checklist_gateway.match", "Mac Registry boundary");
requireText(macMain, "checklist_result.identity_id", "Mac Registry receipt");

console.log(
  JSON.stringify(
    {
      schema: "tcos.kingmaker-instacomp.architecture-certification.v3",
      status: "passed",
      thinWrappers: wrappers.size,
      dynamicMarketplaceWrapperCertified: true,
      auditedPendingJob: true,
      storedDistinctFrontBackRequired: true,
      capabilityCount: 10,
      canonicalIdentityAuthority: "central_checklist_registry",
      intelligenceOwner: "instacomp_ai",
      executionOwner: "kingmaker",
      sellerMutationAllowedForInstaComp: false,
    },
    null,
    2,
  ),
);
